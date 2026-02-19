
import * as storage from './storage';
import { LiteralnessCard, Question, Flashcard, SrsItem } from '../types';
import * as srs from './srsService';

/**
 * Repository Service
 * Centralizes all cross-store data access to ensure LIT_REF integrity.
 */

export const nucleusRepo = {
    /**
     * Rehydrates an article completely, fetching linked content directly from DB 
     * to avoid "missing items" UI bugs.
     */
    async getFullArticleData(litRef: string) {
        const canon = srs.canonicalizeLitRef(litRef);
        
        // 1. Get Core Card
        const cards = await storage.loadData<LiteralnessCard[]>('revApp_literalness_v1') || [];
        const card = cards.find(c => srs.canonicalizeLitRef(c.id) === canon);
        
        if (!card) return null;

        // 2. Direct Index Search in DB (Source of Truth)
        // Fix: storage.STORES.QUESTIONS/FLASHCARDS do not exist. Using STORES.CONTENT and filtering by type.
        const allItems = await storage.dbGetByIndex<any>(storage.STORES.CONTENT, 'litRef', canon);
        const questions = allItems.filter(i => i.type === 'QUESTION').map(i => i.payload as Question);
        const flashcards = allItems.filter(i => i.type === 'FLASHCARD' || i.type === 'PAIR').map(i => i.payload as Flashcard);
        
        return {
            card,
            questions: questions.filter(q => !q.isGapType),
            gaps: srs.getGapsForCard(card, questions),
            flashcards: flashcards.filter(f => !f.tags?.includes('pair-match')),
            pairs: flashcards.filter(f => f.tags?.includes('pair-match'))
        };
    },

    /**
     * Persists imported batch ensuring immutability rules.
     * IMPLEMENTS UPSERT AND CHILD REPLACEMENT STRATEGY.
     */
    async saveImportBatch(batch: { cards: LiteralnessCard[], questions: Question[], flashcards: Flashcard[] }) {
        // 1. Upsert Nucleus Cards
        // Since we are using put, it overwrites if ID exists (Upsert).
        await storage.dbPut(storage.STORES.NUCLEUS, batch.cards);
        
        // 2. Handle Content Synchronization (Replace Children)
        // For each card in the batch, we must ensure the DB state matches the batch state for its children.
        // Any child in DB that is NOT in the batch must be deleted (Pruning).
        
        const contentStoreName = storage.STORES.CONTENT;
        const db = await storage.openDB();
        
        for (const card of batch.cards) {
            const litRef = card.id;

            // A. Get existing children from DB for this Card
            // This is crucial: we fetch what is currently stored for this LitRef
            const existingItems = await storage.dbGetByIndex<any>(contentStoreName, 'litRef', litRef);
            
            // B. Get new children from Batch for this Card
            // We use canonical LitRef to match
            const newQuestions = batch.questions.filter(q => srs.canonicalizeLitRef(q.lawRef) === litRef);
            const newFlashcards = batch.flashcards.filter(fc => srs.isLinked(fc, litRef));
            
            const newIds = new Set<string>();
            const contentPayloads: any[] = [];
            
            // Prepare new payloads and collect IDs
            newQuestions.forEach(q => {
                 newIds.add(q.id);
                 contentPayloads.push({
                    id: q.id,
                    litRef: litRef,
                    type: 'QUESTION',
                    payload: q
                 });
            });
            
            newFlashcards.forEach(fc => {
                newIds.add(fc.id);
                contentPayloads.push({
                    id: fc.id,
                    litRef: litRef,
                    type: fc.tags?.includes('pair-match') ? 'PAIR' : 'FLASHCARD',
                    payload: fc
                });
            });
            
            // C. Identify Orphans (Exist in DB but not in New Batch)
            // If the batch updates the card, any question NOT in the batch should be considered "Deleted" or "Archived"
            const orphans = existingItems.filter(item => !newIds.has(item.id));
            
            // D. Delete Orphans
            if (orphans.length > 0) {
                console.log(`[Repository] Pruning ${orphans.length} orphans for ${litRef}`);
                const tx = db.transaction(contentStoreName, 'readwrite');
                const store = tx.objectStore(contentStoreName);
                orphans.forEach(o => store.delete(o.id));
                await new Promise(resolve => tx.oncomplete = resolve);
            }
            
            // E. Upsert New Content
            if (contentPayloads.length > 0) {
                 await storage.dbPut(contentStoreName, contentPayloads);
            }
        }
        
        // Sync with legacy stores for context compatibility (keeping this for now as per original code)
        // (In a full migration, we'd remove the legacy loadData calls)
        const existingCards = await storage.loadData<LiteralnessCard[]>('revApp_literalness_v1') || [];
        const existingQs = await storage.loadData<Question[]>('revApp_questions_v5_react') || [];
        const existingFs = await storage.loadData<Flashcard[]>('revApp_flashcards_v1') || [];

        // For Legacy Stores, we also need to apply the upsert/replace logic partially
        // Filter out old versions of the cards we are importing
        const batchCardIds = new Set(batch.cards.map(c => c.id));
        const batchQuestionIds = new Set(batch.questions.map(q => q.id));
        const batchFlashcardIds = new Set(batch.flashcards.map(f => f.id));

        const updatedCards = [...existingCards.filter(ec => !batchCardIds.has(ec.id)), ...batch.cards];
        const updatedQs = [...existingQs.filter(eq => !batchQuestionIds.has(eq.id)), ...batch.questions];
        const updatedFs = [...existingFs.filter(ef => !batchFlashcardIds.has(ef.id)), ...batch.flashcards];

        await storage.saveData('revApp_literalness_v1', updatedCards);
        await storage.saveData('revApp_questions_v5_react', updatedQs);
        await storage.saveData('revApp_flashcards_v1', updatedFs);
    },

    /**
     * FULL BATCH DELETION
     * Deletes the nucleus and all related content (Questions, Flashcards, Progress)
     * Returns the IDs of deleted items to allow UI state synchronization.
     */
    async deleteNucleus(litRef: string): Promise<{ deletedQuestions: string[], deletedFlashcards: string[] }> {
        const canon = srs.canonicalizeLitRef(litRef);
        console.log(`[Repository] Deleting Nucleus: ${canon}`);

        // 1. Fetch children IDs first (so we know what to remove from Context state)
        const allItems = await storage.dbGetByIndex<any>(storage.STORES.CONTENT, 'litRef', canon);
        const deletedQuestions = allItems.filter(i => i.type === 'QUESTION' || i.type === 'LACUNA').map(i => i.id);
        const deletedFlashcards = allItems.filter(i => i.type === 'FLASHCARD' || i.type === 'PAIR').map(i => i.id);

        // 2. Perform Atomic Delete in DB
        await storage.deleteAtomicBatch(canon);

        // 3. Clean Legacy LocalStorage to match DB
        // (This step is technically redundant if apps relied purely on DB, but necessary for current hybrid architecture)
        const legacyCards = await storage.loadData<LiteralnessCard[]>('revApp_literalness_v1') || [];
        const legacyQs = await storage.loadData<Question[]>('revApp_questions_v5_react') || [];
        const legacyFs = await storage.loadData<Flashcard[]>('revApp_flashcards_v1') || [];

        const nextCards = legacyCards.filter(c => srs.canonicalizeLitRef(c.id) !== canon);
        // Note: Legacy Questions might not have litRef property set correctly if older, 
        // so we filter by the IDs we found in the content store as well as the ref match.
        const nextQs = legacyQs.filter(q => !deletedQuestions.includes(q.id) && srs.canonicalizeLitRef(q.lawRef) !== canon);
        const nextFs = legacyFs.filter(f => !deletedFlashcards.includes(f.id) && srs.canonicalizeLitRef(f.litRef) !== canon && !f.tags?.includes(canon));

        await storage.saveData('revApp_literalness_v1', nextCards);
        await storage.saveData('revApp_questions_v5_react', nextQs);
        await storage.saveData('revApp_flashcards_v1', nextFs);

        return { deletedQuestions, deletedFlashcards };
    }
};

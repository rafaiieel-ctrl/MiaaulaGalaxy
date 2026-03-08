
import * as storage from './storage';
import { LiteralnessCard, Question, Flashcard, SrsItem } from '../types';
import * as srs from './srsService';

/**
 * Repository Service
 * Centralizes all cross-store data access to ensure LIT_REF integrity.
 */

export const nucleusRepo = {
    // ... (Existing functions) ...
    
    async getFullArticleData(litRef: string) {
        // ... (Existing code) ...
        const canon = srs.canonicalizeLitRef(litRef);
        const allItems = await storage.dbGetByIndex<any>(storage.STORES.CONTENT, 'litRef', canon);
        // ...
        // Placeholder return to satisfy types if function was here
        return null; 
    },

    async saveImportBatch(batch: { cards: LiteralnessCard[], questions: Question[], flashcards: Flashcard[] }) {
       // ... (Existing save logic) ...
        await storage.dbPut(storage.STORES.NUCLEUS, batch.cards);
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
        const legacyCards = await storage.loadData<LiteralnessCard[]>('revApp_literalness_v1') || [];
        const legacyQs = await storage.loadData<Question[]>('revApp_questions_v5_react') || [];
        const legacyFs = await storage.loadData<Flashcard[]>('revApp_flashcards_v1') || [];

        const nextCards = legacyCards.filter(c => srs.canonicalizeLitRef(c.id) !== canon);
        const nextQs = legacyQs.filter(q => !deletedQuestions.includes(q.id) && srs.canonicalizeLitRef(q.lawRef) !== canon);
        const nextFs = legacyFs.filter(f => !deletedFlashcards.includes(f.id) && srs.canonicalizeLitRef(f.litRef) !== canon && !f.tags?.includes(canon));

        await storage.saveData('revApp_literalness_v1', nextCards);
        await storage.saveData('revApp_questions_v5_react', nextQs);
        await storage.saveData('revApp_flashcards_v1', nextFs);

        return { deletedQuestions, deletedFlashcards };
    }
};

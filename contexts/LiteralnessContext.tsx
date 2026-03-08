
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { LiteralnessCard, Question, Flashcard } from '../types';
import * as storage from '../services/storage';
import * as idGen from '../services/idGenerator';
import * as srs from '../services/srsService';
import { nucleusRepo } from '../services/repositoryService'; 

const LiteralnessStateContext = createContext<LiteralnessCard[] | undefined>(undefined);
const LiteralnessDispatchContext = createContext<any | undefined>(undefined);

export const LiteralnessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [cards, setCards] = useState<LiteralnessCard[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const boot = async () => {
             // ... (Existing load logic) ...
            const db = await storage.openDB();
            const tx = db.transaction(storage.STORES.NUCLEUS, 'readwrite');
            const store = tx.objectStore(storage.STORES.NUCLEUS);
            const request = store.getAll();
            
            request.onsuccess = () => {
                const loadedCards: LiteralnessCard[] = request.result || [];
                setCards(loadedCards);
                setIsLoaded(true);
            };
        };
        boot();
    }, []);

    // Updated Signature: Include 'gaps' array
    const addBatchCards = useCallback(async (newCards: LiteralnessCard[], questions: Question[] = [], flashcards: Flashcard[] = [], gaps: any[] = []) => {
        // Validação defensiva
        const safeQuestions = Array.isArray(questions) ? questions : [];
        const safeFlashcards = Array.isArray(flashcards) ? flashcards : [];
        const safeGaps = Array.isArray(gaps) ? gaps : [];

        // 1. Persiste Núcleos
        await storage.dbPut(storage.STORES.NUCLEUS, newCards);
        
        // 2. Persiste Questões
        if (safeQuestions.length > 0) {
            const questionsContent = safeQuestions.map((q, idx) => ({
                id: idGen.makeStableId(q.lawRef || '', 'QUESTION', q.questionRef || idx),
                litRef: srs.canonicalizeLitRef(q.lawRef),
                type: 'QUESTION',
                payload: q
            }));
            await storage.dbPut(storage.STORES.CONTENT, questionsContent);
        }

        // 3. Persiste Flashcards
        if (safeFlashcards.length > 0) {
            const flashcardsContent = safeFlashcards.map((f, idx) => {
                const tags = f.tags || [];
                return {
                    id: f.id || idGen.makeStableId(srs.resolveLitRef(f), 'FLASHCARD', idx),
                    litRef: srs.resolveLitRef(f),
                    type: tags.includes('pair-match') ? 'PAIR' : 'FLASHCARD',
                    payload: f
                };
            });
            await storage.dbPut(storage.STORES.CONTENT, flashcardsContent);
        }
        
        // 4. Persiste Gaps (CRÍTICO para o jogo de lacunas funcionar)
        if (safeGaps.length > 0) {
             await storage.dbPut(storage.STORES.CONTENT, safeGaps);
        }

        setCards(prev => {
            const incomingIds = new Set(newCards.map(c => c.id));
            return [...prev.filter(c => !incomingIds.has(c.id)), ...newCards];
        });
    }, []);

    const updateCard = useCallback(async (card: LiteralnessCard) => {
        await storage.dbPut(storage.STORES.NUCLEUS, card);
        setCards(prev => prev.map(c => c.id === card.id ? card : c));
    }, []);

    const moveCardToLaw = useCallback(async (cardId: string, newLawId: string) => {
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        const updated = { ...card, lawId: newLawId };
        await updateCard(updated);
    }, [cards, updateCard]);

    const deleteCards = useCallback(async (ids: string[]) => {
        // UI should call nucleusRepo.deleteNucleus first for cascade logic.
        // This function syncs the React state and ensures Nucleus store cleanup.
        for (const id of ids) {
             if (cards.some(c => c.id === id)) {
                 // Redundant if repo called, but safe
                 await storage.dbDelete(storage.STORES.NUCLEUS, id);
             }
        }
        setCards(prev => prev.filter(c => !ids.includes(c.id)));
    }, [cards]);

    const renameLawGroup = useCallback(async (oldLawId: string, newLawId: string) => {
        const cardsToUpdate = cards.filter(c => c.lawId === oldLawId);
        const updatedCards = cardsToUpdate.map(c => ({ ...c, lawId: newLawId }));
        
        await storage.dbPut(storage.STORES.NUCLEUS, updatedCards);
        
        setCards(prev => prev.map(c => {
            const update = updatedCards.find(u => u.id === c.id);
            return update ? update : c;
        }));
    }, [cards]);

    const dispatch = useMemo(() => ({ addBatchCards, updateCard, deleteCards, moveCardToLaw, renameLawGroup }), [addBatchCards, updateCard, deleteCards, moveCardToLaw, renameLawGroup]);

    return (
        <LiteralnessStateContext.Provider value={cards}>
            <LiteralnessDispatchContext.Provider value={dispatch}>
                {children}
            </LiteralnessDispatchContext.Provider>
        </LiteralnessStateContext.Provider>
    );
};

export const useLiteralnessState = () => useContext(LiteralnessStateContext)!;
export const useLiteralnessDispatch = () => useContext(LiteralnessDispatchContext)!;

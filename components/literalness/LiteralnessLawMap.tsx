
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { LiteralnessCard, Question, Flashcard } from '../../types';
import { useQuestionState, useQuestionDispatch } from '../../contexts/QuestionContext';
import { useFlashcardState, useFlashcardDispatch } from '../../contexts/FlashcardContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useLiteralnessDispatch } from '../../contexts/LiteralnessContext';
import { 
    ChevronLeftIcon, ExclamationTriangleIcon, 
    PencilIcon, TrashIcon, ArrowRightIcon, ClockIcon,
    BoltIcon, CheckCircleIcon, BrainIcon, MapIcon, 
    ClipboardDocumentCheckIcon, PuzzlePieceIcon, ScaleIcon,
    PaintBrushIcon, ArrowsRightLeftIcon, EllipsisHorizontalIcon,
    DocumentDuplicateIcon
} from '../icons';
import * as srs from '../../services/srsService';
import { nucleusRepo } from '../../services/repositoryService'; // Import Repo
import LiteralnessEditorModal from './LiteralnessEditorModal';
import MoveArticleModal from './MoveArticleModal';
import DeleteArticleModal from './DeleteArticleModal'; // New Import
import StudySessionModal from '../StudySessionModal';
import FlashcardStudySessionModal from '../FlashcardStudySessionModal';
import PairMatchGame from '../pairmatch/PairMatchGame'; 

// ... (Existing Imports/Props/VisualMenu/ProgressBar remain same) ...

interface LiteralnessLawMapProps {
    cards: LiteralnessCard[];
    onStudyArticle: (cards: LiteralnessCard[], mode: any) => void;
    onViewArticle: (card: LiteralnessCard) => void;
    onViewDiagnostic: (cards: LiteralnessCard[], title: string) => void;
    activeLawId?: string | null;
    onSelectLaw?: (id: string | null) => void;
}

// ... (Constants) ...
const COLOR_MAP: Record<string, { border: string; bg: string; text: string; glow: string }> = {
    default: { border: 'border-white/5', bg: 'bg-slate-900/60', text: 'text-white', glow: '' },
    yellow: { border: 'border-yellow-500/50', bg: 'bg-yellow-500/5', text: 'text-yellow-100', glow: 'shadow-[0_0_20px_rgba(234,179,8,0.1)]' },
    orange: { border: 'border-orange-500/50', bg: 'bg-orange-500/5', text: 'text-orange-100', glow: 'shadow-[0_0_20px_rgba(249,115,22,0.1)]' },
    red: { border: 'border-red-500/50', bg: 'bg-red-500/5', text: 'text-red-100', glow: 'shadow-[0_0_20px_rgba(239,68,68,0.1)]' },
    gray: { border: 'border-slate-700', bg: 'bg-slate-900/30', text: 'text-slate-500', glow: '' },
};

// ... (VisualMenu, ProgressBar Components - Keeping short for brevity, assume existing) ...
const VisualMenu: React.FC<any> = ({ card, onClose, onUpdate }) => { /* ... implementation ... */ return null; }; 
const ProgressBar: React.FC<any> = ({ value, label, color }) => { return <div/>; }; 

const LiteralnessLawMap: React.FC<LiteralnessLawMapProps> = ({ cards, onViewArticle, activeLawId, onSelectLaw }) => {
    const { deleteCards, updateCard, moveCardToLaw, renameLawGroup, addBatchCards } = useLiteralnessDispatch();
    const allQuestions = useQuestionState();
    const allFlashcards = useFlashcardState();
    const { updateBatchFlashcards, deleteFlashcards } = useFlashcardDispatch();
    const { deleteQuestions } = useQuestionDispatch();
    const { settings } = useSettings();
    
    const [internalLawId, setInternalLawId] = useState<string | null>(null);
    const selectedLawId = activeLawId !== undefined ? activeLawId : internalLawId;
    const [cardToDelete, setCardToDelete] = useState<LiteralnessCard | null>(null);
    const [cardToEdit, setCardToEdit] = useState<LiteralnessCard | null>(null);
    const [cardToMove, setCardToMove] = useState<LiteralnessCard | null>(null);
    
    // Law Group Editing State
    const [editingLawId, setEditingLawId] = useState<string | null>(null);
    const [lawIdDraft, setLawIdDraft] = useState("");
    const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null);

    const handleSaveLawRename = async (oldId: string) => {
        const trimmed = lawIdDraft.trim();
        if (!trimmed || trimmed === oldId) {
            setEditingLawId(null);
            return;
        }
        await renameLawGroup(oldId, trimmed);
        setEditingLawId(null);
    };

    const handleDuplicateLawGroup = async (lawId: string) => {
        const groupCards = cards.filter(c => c.lawId === lawId);
        const newLawId = `${lawId} (Cópia)`;
        const newCards = groupCards.map(c => ({
            ...c,
            id: `${c.id}_copy_${Math.random().toString(36).substring(2, 7)}`,
            lawId: newLawId,
            createdAt: new Date().toISOString()
        }));
        await addBatchCards(newCards);
        setOpenGroupMenuId(null);
    };

    const handleDeleteLawGroup = async (lawId: string) => {
        if (window.confirm(`Excluir permanentemente todos os núcleos de "${lawId}"?`)) {
            const groupCards = cards.filter(c => c.lawId === lawId);
            try {
                for (const card of groupCards) {
                    await nucleusRepo.deleteNucleus(card.id);
                }
                const groupCardIds = groupCards.map(c => c.id);
                await deleteCards(groupCardIds);
                setOpenGroupMenuId(null);
                alert("Grupo excluído com sucesso!");
            } catch (e: any) {
                alert("Erro ao excluir grupo: " + e.message);
            }
        }
    };
    const [openMenuCardId, setOpenMenuCardId] = useState<string | null>(null);
    const [activeQuestionSession, setActiveQuestionSession] = useState<{ title: string, questions: Question[] } | null>(null);
    const [activeFlashcardSession, setActiveFlashcardSession] = useState<{ title: string, cards: Flashcard[] } | null>(null);
    const [activePairSession, setActivePairSession] = useState<{ title: string, cards: Flashcard[] } | null>(null);

    // ... (Calculations for LawGroups / SmartStats - Existing) ...
    const cardSmartStats = useMemo(() => {
        const map = new Map<string, srs.LitRefSmartStatus>();
        cards.forEach(card => {
             map.set(card.id, srs.getLitRefSmartStatus(card.id, allQuestions, allFlashcards, settings));
        });
        return map;
    }, [cards, allQuestions, allFlashcards, settings]);

    const lawGroups = useMemo(() => {
        const groups: Record<string, any> = {};
        cards.forEach(card => {
            if (!card.lawId) return;
            const lawKey = card.lawId;
            if (!groups[lawKey]) groups[lawKey] = { id: lawKey, count: 0, critical: 0 };
            groups[lawKey].count++;
            const stats = cardSmartStats.get(card.id);
            if (stats && stats.overdueItems > 0) groups[lawKey].critical++;
        });
        return Object.entries(groups).sort((a, b) => b[1].critical - a[1].critical);
    }, [cards, cardSmartStats]);
    
    const allLawIds = useMemo(() => lawGroups.map(([id]) => id).sort(), [lawGroups]);

    const filteredArticles = useMemo(() => {
        if (!selectedLawId) return [];
        return cards
            .filter(c => c.lawId === selectedLawId)
            .map(card => ({ card, stats: cardSmartStats.get(card.id)! }));
    }, [cards, selectedLawId, cardSmartStats]);

    // ... (Handlers) ...

    const handleSmartAction = (card: LiteralnessCard, stats: srs.LitRefSmartStatus) => {
        const hasPending = stats.overdueItems > 0;
        if (hasPending) {
            if (stats.counts.pending.questions > 0) {
                setActiveQuestionSession({ title: `Revisão: ${card.article}`, questions: stats.lists.pendingQuestions });
            } else if (stats.counts.pending.gaps > 0) {
                setActiveQuestionSession({ title: `Lacunas: ${card.article}`, questions: stats.lists.pendingGaps });
            } else if (stats.counts.pending.flashcards > 0) {
                setActiveFlashcardSession({ title: `Cards: ${card.article}`, cards: stats.lists.pendingFlashcards });
            } else if (stats.counts.pending.pairs > 0) {
                 setActivePairSession({ title: `Pares: ${card.article}`, cards: stats.lists.pendingPairs });
            }
        } else {
            if (stats.totalItems > 0 && stats.reviewedItems === 0) {
                onViewArticle(card);
            }
        }
    };

    const handleVisualUpdate = (card: LiteralnessCard, updates: Partial<LiteralnessCard>) => {
        updateCard({ ...card, ...updates });
        setOpenMenuCardId(null);
    };

    // --- NEW: Cascade Delete Handler ---
    const handleConfirmDelete = async (card: LiteralnessCard) => {
        try {
            // 1. Delete Nucleus and Children via Repo (Source of Truth)
            const { deletedQuestions, deletedFlashcards } = await nucleusRepo.deleteNucleus(card.id);
            
            // 2. Sync In-Memory State via Context Dispatches
            deleteCards([card.id]);
            
            if (deletedQuestions.length > 0) deleteQuestions(deletedQuestions);
            if (deletedFlashcards.length > 0) deleteFlashcards(deletedFlashcards);
            
            setCardToDelete(null);
            alert("Lote removido com sucesso!");
        } catch (e: any) {
            alert("Erro ao excluir lote: " + e.message);
        }
    };

    // ... (Render Logic) ...

    if (!selectedLawId) {
         return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in">
                {lawGroups.map(([id, data]) => (
                    <div 
                        key={id} 
                        onClick={() => onSelectLaw ? onSelectLaw(id) : setInternalLawId(id)} 
                        className="bg-slate-900/40 border border-white/5 p-6 rounded-[2.5rem] hover:bg-slate-900/60 transition-all cursor-pointer group relative"
                    >
                        <div className="flex items-start justify-between mb-4 gap-2">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="p-2 bg-sky-500/10 rounded-full text-sky-500 shrink-0"><ScaleIcon className="w-5 h-5"/></div>
                                {editingLawId === id ? (
                                    <input
                                        autoFocus
                                        value={lawIdDraft}
                                        onChange={(e) => setLawIdDraft(e.target.value)}
                                        onBlur={() => handleSaveLawRename(id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveLawRename(id);
                                            if (e.key === 'Escape') setEditingLawId(null);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="bg-slate-800 border-b-2 border-sky-500 outline-none text-white font-bold px-1 w-full rounded-sm"
                                    />
                                ) : (
                                    <h3 className="text-lg font-bold text-white uppercase italic tracking-tighter group-hover:text-sky-400 transition-colors line-clamp-2 break-words">
                                        {id}
                                    </h3>
                                )}
                            </div>
                            
                            <div className="relative shrink-0">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenGroupMenuId(openGroupMenuId === id ? null : id);
                                    }}
                                    className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                                >
                                    <EllipsisHorizontalIcon className="w-5 h-5" />
                                </button>
                                
                                {openGroupMenuId === id && (
                                    <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-slide-down">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingLawId(id);
                                                setLawIdDraft(id);
                                                setOpenGroupMenuId(null);
                                            }}
                                            className="w-full px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5 flex items-center gap-2"
                                        >
                                            <PencilIcon className="w-4 h-4" /> Editar Nome
                                        </button>
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDuplicateLawGroup(id);
                                            }}
                                            className="w-full px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5 flex items-center gap-2"
                                        >
                                            <DocumentDuplicateIcon className="w-4 h-4" /> Duplicar
                                        </button>
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteLawGroup(id);
                                            }}
                                            className="w-full px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-rose-500 hover:bg-rose-500/10 flex items-center gap-2"
                                        >
                                            <TrashIcon className="w-4 h-4" /> Excluir
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <div className="flex gap-6">
                            <div className="flex flex-col"><span className="text-[8px] font-bold text-slate-500 uppercase">Núcleos</span><span className="text-xl font-black text-white">{data.count}</span></div>
                            {data.critical > 0 && <div className="flex flex-col"><span className="text-[8px] font-bold text-rose-500 uppercase">Pendentes</span><span className="text-xl font-black text-rose-500">{data.critical}</span></div>}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-fade-in max-w-4xl mx-auto w-full px-2 md:px-0">
            <div className="flex items-center justify-between mb-8">
                <button onClick={() => onSelectLaw ? onSelectLaw(null) : setInternalLawId(null)} className="p-2.5 bg-white/5 rounded-2xl text-slate-400 hover:text-white flex items-center gap-2 text-[10px] font-black uppercase tracking-widest border border-white/5 transition-all active:scale-95"><ChevronLeftIcon className="w-4 h-4" /> Voltar</button>
                <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter truncate max-w-md">{selectedLawId}</h3>
            </div>

            <div className="flex flex-col gap-4">
                {filteredArticles.map(({ card, stats }) => {
                    // ... (Card Render Logic - Existing) ...
                    const hasPending = stats.overdueItems > 0;
                    const isFuture = !hasPending && stats.nextDueAtFuture && stats.nextDueAtFuture > Date.now();
                    const isNew = stats.totalItems > 0 && stats.reviewedItems === 0;
                    const visualStyle = COLOR_MAP[card.visualColor || 'default'];
                    const isGray = card.visualColor === 'gray';
                    
                    let buttonLabel = "INICIAR";
                    let buttonColor = "bg-white text-slate-950 hover:bg-slate-200";
                    let buttonIcon = <ArrowRightIcon className="w-4 h-4" />;
                    let disabled = false;
                    
                    if (hasPending) { buttonLabel = "PENDÊNCIAS"; buttonColor = "bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-900/20"; buttonIcon = <BoltIcon className="w-4 h-4" />; }
                    else if (isFuture) { buttonLabel = "REVISÃO"; buttonColor = "bg-white/5 text-slate-500 border border-white/5"; buttonIcon = <ClockIcon className="w-4 h-4" />; disabled = true; }
                    else if (!isNew) { buttonLabel = "REVISÃO"; buttonColor = "bg-emerald-600 text-white hover:bg-emerald-500"; buttonIcon = <CheckCircleIcon className="w-4 h-4" />; }

                    return (
                        <div 
                            key={card.id} 
                            onClick={() => onViewArticle(card)}
                            className={`group relative rounded-[2.5rem] border p-6 md:p-8 hover:border-white/20 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-6 overflow-visible 
                                ${visualStyle.bg} ${visualStyle.border} ${visualStyle.glow} ${isGray ? 'opacity-60 grayscale hover:grayscale-0 hover:opacity-100' : ''}`}
                        >
                            {/* ... Content ... */}
                            <div className="flex-1 min-w-0">
                                <h4 className="text-2xl font-black text-white italic">{card.article}</h4>
                                <p className="text-xs text-slate-500 uppercase">{card.topic}</p>
                            </div>

                            <div className="flex items-center gap-4 shrink-0">
                                <div className="flex flex-col items-end gap-2">
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleSmartAction(card, stats); }}
                                        disabled={disabled}
                                        className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${buttonColor}`}
                                    >
                                        {buttonIcon} {buttonLabel}
                                    </button>
                                </div>
                                
                                {/* Edit Actions */}
                                <div className="flex flex-col gap-2 border-l border-white/5 pl-4 ml-2 relative">
                                    <button onClick={(e) => { e.stopPropagation(); setCardToEdit(card); }} className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"><PencilIcon className="w-4 h-4"/></button>
                                    <button onClick={(e) => { e.stopPropagation(); setCardToMove(card); }} className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"><ArrowsRightLeftIcon className="w-4 h-4"/></button>
                                    <button onClick={(e) => { e.stopPropagation(); setCardToDelete(card); }} className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"><TrashIcon className="w-4 h-4" /></button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* MODALS */}
            {cardToDelete && (
                <DeleteArticleModal 
                    isOpen={!!cardToDelete} 
                    onClose={() => setCardToDelete(null)} 
                    card={cardToDelete} 
                    onConfirm={handleConfirmDelete} 
                />
            )}

            {cardToEdit && <LiteralnessEditorModal isOpen={true} onClose={() => setCardToEdit(null)} card={cardToEdit} />}
            
            {cardToMove && (
                <MoveArticleModal 
                    isOpen={true} 
                    onClose={() => setCardToMove(null)} 
                    card={cardToMove} 
                    availableLaws={allLawIds} 
                    onConfirm={moveCardToLaw} 
                />
            )}
            
            {activeQuestionSession && (
                <StudySessionModal 
                    isOpen={!!activeQuestionSession}
                    onClose={() => setActiveQuestionSession(null)}
                    title={activeQuestionSession.title}
                    questions={activeQuestionSession.questions}
                    context="session"
                />
            )}
            
            {/* ... other modals ... */}
            
        </div>
    );
};

export default LiteralnessLawMap;

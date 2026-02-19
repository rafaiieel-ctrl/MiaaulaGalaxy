
import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { LiteralnessCard, Question, Flashcard } from '../../types';
import { XMarkIcon, TrashIcon, ExclamationTriangleIcon } from '../icons';
import * as srs from '../../services/srsService';
import { useQuestionState } from '../../contexts/QuestionContext';
import { useFlashcardState } from '../../contexts/FlashcardContext';
import { useSettings } from '../../contexts/SettingsContext';

interface DeleteArticleModalProps {
    isOpen: boolean;
    onClose: () => void;
    card: LiteralnessCard;
    onConfirm: (card: LiteralnessCard) => void;
}

const DeleteArticleModal: React.FC<DeleteArticleModalProps> = ({ isOpen, onClose, card, onConfirm }) => {
    const [confirmText, setConfirmText] = useState('');
    const allQuestions = useQuestionState();
    const allFlashcards = useFlashcardState();
    const { settings } = useSettings();

    // Calculate Impact stats
    const stats = useMemo(() => {
        if (!isOpen) return { questions: 0, gaps: 0, flashcards: 0, pairs: 0, progress: 0 };
        const smartStats = srs.getLitRefSmartStatus(card.id, allQuestions, allFlashcards, settings);
        
        const qCount = smartStats.counts.total.questions;
        const gCount = smartStats.counts.total.gaps;
        const fCount = smartStats.counts.total.flashcards;
        const pCount = smartStats.counts.total.pairs;
        const reviewed = smartStats.reviewedItems;

        return {
            questions: qCount,
            gaps: gCount,
            flashcards: fCount,
            pairs: pCount,
            progress: reviewed
        };
    }, [isOpen, card, allQuestions, allFlashcards, settings]);

    if (!isOpen) return null;

    const requiredText = "DELETAR";
    const isMatch = confirmText.trim().toUpperCase() === requiredText;

    const handleConfirm = () => {
        if (isMatch) {
            onConfirm(card);
            onClose();
        }
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-slate-900 border-2 border-rose-500/30 w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                
                <header className="p-6 border-b border-white/5 flex justify-between items-center bg-rose-950/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-rose-500/10 rounded-xl text-rose-500 border border-rose-500/20">
                            <ExclamationTriangleIcon className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="font-black text-rose-400 text-lg leading-tight uppercase tracking-tight">Excluir Lote?</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Ação Irreversível</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-500 hover:text-white transition-colors"><XMarkIcon className="w-5 h-5"/></button>
                </header>

                <div className="p-6 space-y-6">
                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-2">
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Lote Selecionado</p>
                        <h4 className="text-white font-black text-xl leading-tight italic">{card.article}</h4>
                        <p className="text-xs text-sky-500 font-mono">{card.lawId} • {card.topic}</p>
                    </div>

                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">
                            Esta ação apagará <strong>permanentemente</strong> o artigo e todo o conteúdo vinculado:
                        </p>
                        
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-black/30 p-2 rounded flex justify-between px-3 border border-white/5">
                                <span className="text-slate-500">Questões</span>
                                <span className="text-white font-bold">{stats.questions}</span>
                            </div>
                            <div className="bg-black/30 p-2 rounded flex justify-between px-3 border border-white/5">
                                <span className="text-slate-500">Lacunas</span>
                                <span className="text-white font-bold">{stats.gaps}</span>
                            </div>
                            <div className="bg-black/30 p-2 rounded flex justify-between px-3 border border-white/5">
                                <span className="text-slate-500">Flashcards</span>
                                <span className="text-white font-bold">{stats.flashcards}</span>
                            </div>
                            <div className="bg-black/30 p-2 rounded flex justify-between px-3 border border-white/5">
                                <span className="text-slate-500">Pares</span>
                                <span className="text-white font-bold">{stats.pairs}</span>
                            </div>
                        </div>
                        
                        {stats.progress > 0 && (
                             <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded text-amber-500 text-xs font-bold text-center">
                                 ⚠️ {stats.progress} registros de progresso serão perdidos.
                             </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                            Digite <span className="text-white bg-white/10 px-1 rounded mx-1 select-all">{requiredText}</span> para confirmar
                        </label>
                        <input 
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-white font-bold outline-none focus:border-rose-500 transition-all text-center uppercase tracking-widest placeholder-slate-700"
                            placeholder={requiredText}
                        />
                    </div>
                </div>

                <footer className="p-6 border-t border-white/5 bg-slate-950/50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-3 rounded-xl text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-white hover:bg-white/5 transition-colors">Cancelar</button>
                    <button 
                        onClick={handleConfirm}
                        disabled={!isMatch}
                        className={`px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg transition-all flex items-center gap-2 
                            ${isMatch 
                                ? 'bg-rose-600 text-white hover:bg-rose-500 shadow-rose-900/20 active:scale-95' 
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5'}`
                        }
                    >
                        <TrashIcon className="w-4 h-4" />
                        Apagar Tudo
                    </button>
                </footer>
            </div>
        </div>,
        document.body
    );
};

export default DeleteArticleModal;

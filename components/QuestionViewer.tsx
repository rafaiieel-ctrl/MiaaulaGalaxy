
import React, { useMemo } from 'react';
import { Question, EvidenceItem } from '../types';
import { CheckCircleIcon, XCircleIcon, LockClosedIcon, TrashIcon, ScaleIcon } from './icons';
import QuestionExplanationBlocks from './QuestionExplanationBlocks';
import PromptText from './ui/PromptText';
import { sanitizeOptionText } from '../services/questionParser';

interface QuestionViewerProps {
    question: Question;
    selectedOption: string | null;
    isRevealed: boolean;
    onOptionSelect?: (key: string) => void;
    className?: string;
    showMedia?: boolean;
    isLocked?: boolean; 
    
    eliminatedOptions?: string[];
    onEliminate?: (key: string) => void;
    isEliminationMode?: boolean;
    highlightText?: string;
    
    evidence?: { stem: EvidenceItem[], options: Record<string, EvidenceItem[]> } | undefined;
    orderedKeys?: string[]; // DEPRECATED: Ignored now to enforce stable order
}

const QuestionViewer: React.FC<QuestionViewerProps> = ({ 
    question, 
    selectedOption, 
    isRevealed, 
    onOptionSelect, 
    className = "",
    showMedia = true,
    isLocked = false,
    eliminatedOptions = [],
    onEliminate,
    isEliminationMode = false,
    highlightText,
    evidence,
    orderedKeys
}) => {
    
    const handleOptionClick = (key: string) => {
        if (isLocked) return;

        if (isEliminationMode && onEliminate) {
            onEliminate(key);
            return;
        }

        if (eliminatedOptions.includes(key)) return;

        if (!isRevealed && onOptionSelect) {
            onOptionSelect(key);
        }
    };

    // Detect if this should be rendered as a Gap/Cloze question
    const isGapMode = useMemo(() => {
        if (question.isGapType) return true;
        const text = question.questionText || '';
        return /\{\{.+?\}\}|_{3,}/.test(text);
    }, [question]);

    // Detect if this is a True/False (Certo/Errado) Judgement question
    const isJudgementMode = useMemo(() => {
        if (isGapMode) return false;
        const type = (question.questionType || '').toUpperCase();
        const bank = (question.bank || '').toUpperCase();
        
        // Explicit Type or Bank detection
        if (type.includes('C/E') || type.includes('CERTO') || type.includes('JULGAMENTO') || type.includes('V/F')) return true;
        if (bank.includes('CESPE') || bank.includes('CEBRASPE')) return true;

        // Content detection (if options contains "Certo" and "Errado")
        const optValues = Object.values(question.options || {}).map(v => ((v as string) || '').trim().toUpperCase());
        if (optValues.includes('CERTO') && optValues.includes('ERRADO')) return true;
        
        return false;
    }, [question, isGapMode]);

    // Resolve keys for Certo and Errado
    const judgementKeys = useMemo(() => {
        if (!isJudgementMode) return null;
        let rightKey = '';
        let wrongKey = '';

        // 1. Try finding explicit text in options
        Object.entries(question.options || {}).forEach(([k, v]) => {
            const val = ((v as string) || '').toUpperCase().trim();
            if (val === 'CERTO') rightKey = k;
            if (val === 'ERRADO') wrongKey = k;
        });

        // 2. Fallback strategies if text didn't match perfectly but mode is detected
        if (!rightKey || !wrongKey) {
            // Standard C/E mapping (C=Certo, E=Errado)
            if (question.options['C'] && !question.options['A']) {
                rightKey = 'C'; wrongKey = 'E';
            } else {
                // Standard A/B mapping
                rightKey = 'A'; wrongKey = 'B';
            }
        }
        
        return { rightKey, wrongKey };
    }, [isJudgementMode, question.options]);
    
    const renderQuestionText = () => {
        if (!isGapMode && highlightText && question.questionText.includes(highlightText)) {
            const parts = question.questionText.split(highlightText);
            return (
                <span>
                    {parts.map((part, i) => (
                        <React.Fragment key={i}>
                            <PromptText text={part} className="inline" />
                            {i < parts.length - 1 && (
                                <span className="bg-sky-500/30 text-white px-1 rounded animate-pulse font-bold border-b-2 border-sky-500">
                                    {highlightText}
                                </span>
                            )}
                        </React.Fragment>
                    ))}
                </span>
            );
        }
        
        return (
            <PromptText 
                text={question.questionText} 
                mode={isGapMode ? 'gap' : 'plain'}
                revealExpected={isRevealed}
                highlights={evidence?.stem} 
            />
        );
    };

    // Determine list of keys to render for Standard Mode
    // STRICT ALPHABETICAL SORT - DISABLES SHUFFLE VISUALLY
    const keysToRender = useMemo(() => {
        const allowedKeys = ['A', 'B', 'C', 'D', 'E'];
        
        // Defensive check: Only include keys that actually have content
        const validAvailableKeys = Object.keys(question.options || {})
            .filter(k => {
                if (!allowedKeys.includes(k)) return false;
                const val = question.options[k];
                if (!val || typeof val !== 'string' || val.trim() === '') return false;
                
                // HARDENING: Filter bad option text patterns
                const lower = val.trim().toLowerCase();
                if (lower === 'correta' || lower === 'incorreta') return false;
                if (lower.includes('fechamento=')) return false;
                if (lower === '—') return false;

                return true;
            });

        // Always return alphabetically sorted keys (A, B, C...) regardless of input order or shuffle prop
        return validAvailableKeys.sort();
    }, [question.options]);

    return (
        <div className={`space-y-6 pb-10 ${className}`}>
            <div id="question-start-anchor" className="h-px w-full -mt-2"></div>

            {showMedia && (question.questionImage || question.questionAudio) && (
                <div className="flex flex-col gap-4 mb-4">
                    {question.questionImage && <img src={question.questionImage} alt="Questão" className="max-w-full rounded-lg max-h-80 object-contain mx-auto bg-black/20" />}
                    {question.questionAudio && <audio controls src={question.questionAudio} className="w-full" />}
                </div>
            )}

            {/* Question Text */}
            <div className="text-base md:text-lg font-medium leading-relaxed text-slate-200">
                {renderQuestionText()}
            </div>

            <div className="relative">
                {/* LOCKED OVERLAY */}
                {isLocked && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/10 backdrop-blur-sm rounded-xl border border-white/5 animate-fade-in">
                        <div className="bg-slate-900 p-4 rounded-full shadow-2xl border border-indigo-500/50 mb-3 animate-bounce-subtle">
                            <LockClosedIcon className="w-8 h-8 text-indigo-400" />
                        </div>
                        <p className="text-sm font-bold text-white bg-slate-900/80 px-4 py-2 rounded-lg shadow-lg border border-white/10">
                            Complete o P1 e P2 para liberar
                        </p>
                    </div>
                )}
                
                {/* ELIMINATION MODE INDICATOR */}
                {isEliminationMode && !isLocked && (
                    <div className="absolute -top-10 left-0 w-full flex justify-center pointer-events-none z-30">
                        <div className="bg-rose-500 text-white px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest shadow-lg animate-pulse flex items-center gap-2">
                            <TrashIcon className="w-3 h-3" /> Modo Eliminação Ativo
                        </div>
                    </div>
                )}

                {/* SPECIAL UI FOR JUDGEMENT (CERTO/ERRADO) */}
                {isJudgementMode && judgementKeys ? (
                    <div className={`grid grid-cols-2 gap-4 mt-6 transition-all duration-500 ${isLocked ? 'opacity-30 filter blur-[3px] pointer-events-none' : 'opacity-100'}`}>
                        {/* CERTO BUTTON */}
                        <button
                            onClick={() => handleOptionClick(judgementKeys.rightKey)}
                            disabled={isRevealed || isLocked}
                            className={`
                                relative p-6 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all active:scale-[0.98]
                                ${isRevealed
                                    ? (question.correctAnswer === judgementKeys.rightKey 
                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                                        : (selectedOption === judgementKeys.rightKey ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-white/5 border-white/5 text-slate-500 opacity-50'))
                                    : (selectedOption === judgementKeys.rightKey
                                        ? 'bg-sky-600 border-sky-500 text-white shadow-lg'
                                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-emerald-500/50 text-slate-300')
                                }
                            `}
                        >
                            <CheckCircleIcon className="w-8 h-8 mb-1" />
                            <span className="text-lg font-black uppercase tracking-widest">Certo</span>
                        </button>

                        {/* ERRADO BUTTON */}
                        <button
                            onClick={() => handleOptionClick(judgementKeys.wrongKey)}
                            disabled={isRevealed || isLocked}
                            className={`
                                relative p-6 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all active:scale-[0.98]
                                ${isRevealed
                                    ? (question.correctAnswer === judgementKeys.wrongKey 
                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                                        : (selectedOption === judgementKeys.wrongKey ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-white/5 border-white/5 text-slate-500 opacity-50'))
                                    : (selectedOption === judgementKeys.wrongKey
                                        ? 'bg-sky-600 border-sky-500 text-white shadow-lg'
                                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-rose-500/50 text-slate-300')
                                }
                            `}
                        >
                            <XCircleIcon className="w-8 h-8 mb-1" />
                            <span className="text-lg font-black uppercase tracking-widest">Errado</span>
                        </button>
                        
                        {/* Judgement Label */}
                        <div className="col-span-2 text-center mt-2">
                             <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em] flex items-center justify-center gap-2">
                                <ScaleIcon className="w-3 h-3" /> Julgue o Item
                             </span>
                        </div>
                    </div>
                ) : (
                    /* STANDARD MULTIPLE CHOICE UI */
                    <div className={`space-y-2 transition-all duration-500 ${isLocked ? 'opacity-30 filter blur-[3px] pointer-events-none' : 'opacity-100'}`} id="answers-block">
                        {keysToRender.map((key, index) => {
                            const value = question.options[key];
                            if (!value || value.trim() === '') return null;
                            
                            const displayValue = sanitizeOptionText(value as string);
                            if (!displayValue) return null;

                            const isEliminated = eliminatedOptions.includes(key);
                            const isSelected = selectedOption === key;
                            const isCorrect = question.correctAnswer === key;
                            const highlights = evidence?.options[key]; 
                            
                            const visualLabel = String.fromCharCode(65 + index); 
                            
                            let btnClass = "w-full text-left p-3.5 rounded-xl border-2 transition-all flex gap-3 items-start group ";
                            
                            if (isEliminated) {
                                btnClass += "bg-slate-900/50 border-transparent opacity-40 grayscale decoration-slate-500 line-through cursor-not-allowed";
                            } else if (isRevealed) {
                                if (isCorrect) {
                                    btnClass += "bg-emerald-500/20 border-emerald-500 text-emerald-100";
                                } else if (isSelected) {
                                    btnClass += "bg-rose-500/20 border-rose-500 text-rose-100";
                                } else {
                                    btnClass += "bg-white/5 border-white/5 opacity-50";
                                }
                            } else {
                                if (isEliminationMode) {
                                    btnClass += "bg-white/5 border-rose-500/30 hover:bg-rose-500/10 hover:border-rose-500 text-slate-300 cursor-crosshair";
                                } else if (isSelected) {
                                    btnClass += "bg-sky-600 border-sky-500 text-white shadow-lg";
                                } else {
                                    btnClass += "bg-white/5 border-white/10 hover:border-sky-500/30 hover:bg-white/10 active:scale-[0.99]";
                                }
                            }

                            return (
                                <button
                                    key={key}
                                    onClick={() => handleOptionClick(key)}
                                    disabled={isRevealed || (isLocked)}
                                    className={btnClass}
                                >
                                    <strong className={`shrink-0 text-base ${!isRevealed && !isSelected && !isEliminated ? 'text-sky-500 group-hover:text-sky-400' : 'text-current'}`}>{visualLabel})</strong>
                                    <span className="leading-snug pt-0.5 text-sm md:text-base w-full">
                                        <PromptText text={displayValue} highlights={highlights} />
                                    </span>
                                    {isRevealed && isCorrect && <CheckCircleIcon className="w-5 h-5 ml-auto shrink-0 text-emerald-400" />}
                                    {isRevealed && isSelected && !isCorrect && <XCircleIcon className="w-5 h-5 ml-auto shrink-0 text-rose-400" />}
                                    {!isRevealed && isEliminated && <TrashIcon className="w-4 h-4 ml-auto shrink-0 text-slate-600" />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {isRevealed && (
                <div className="animate-fade-in pt-6 border-t border-white/10">
                   <QuestionExplanationBlocks 
                        question={question} 
                        userAnswer={selectedOption} 
                        showTitle={true}
                   />
                </div>
            )}
        </div>
    );
};

export default QuestionViewer;

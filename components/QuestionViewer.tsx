
import React, { useMemo } from 'react';
import { Question, EvidenceItem } from '../types';
import { CheckCircleIcon, XCircleIcon, LockClosedIcon, TrashIcon, ScaleIcon, ExclamationTriangleIcon } from './icons';
import QuestionExplanationBlocks from './QuestionExplanationBlocks';
import PromptText from './ui/PromptText';
import { getSafeQuestionView, sanitizeOptionText } from '../services/questionParser';

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
    orderedKeys?: string[]; 
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
    
    // --- SAFE VIEW LAYER ---
    // Create a safe, non-mutated view of the question where we try to recover 
    // any missing options from the raw block.
    const safeQuestion = useMemo(() => getSafeQuestionView(question), [question]);

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
        if (safeQuestion.isGapType) return true;
        const text = safeQuestion.questionText || '';
        return /\{\{.+?\}\}|_{3,}/.test(text);
    }, [safeQuestion]);

    // Detect if this is a True/False (Certo/Errado) Judgement question
    const isJudgementMode = useMemo(() => {
        if (isGapMode) return false;
        const type = (safeQuestion.questionType || '').toUpperCase();
        const bank = (safeQuestion.bank || '').toUpperCase();
        
        // Explicit Type or Bank detection
        if (type.includes('C/E') || type.includes('CERTO') || type.includes('JULGAMENTO') || type.includes('V/F')) return true;
        if (bank.includes('CESPE') || bank.includes('CEBRASPE')) return true;

        // Content detection
        const optValues = Object.values(safeQuestion.options || {}).map(v => ((v as string) || '').trim().toUpperCase());
        if (optValues.includes('CERTO') && optValues.includes('ERRADO')) return true;
        
        return false;
    }, [safeQuestion, isGapMode]);

    // Resolve keys for Certo and Errado
    const judgementKeys = useMemo(() => {
        if (!isJudgementMode) return null;
        let rightKey = '';
        let wrongKey = '';

        Object.entries(safeQuestion.options || {}).forEach(([k, v]) => {
            const val = ((v as string) || '').toUpperCase().trim();
            if (val === 'CERTO') rightKey = k;
            if (val === 'ERRADO') wrongKey = k;
        });

        if (!rightKey || !wrongKey) {
            if (safeQuestion.options['C'] && !safeQuestion.options['A']) {
                rightKey = 'C'; wrongKey = 'E';
            } else {
                rightKey = 'A'; wrongKey = 'B';
            }
        }
        
        return { rightKey, wrongKey };
    }, [isJudgementMode, safeQuestion.options]);
    
    const renderQuestionText = () => {
        if (!isGapMode && highlightText && safeQuestion.questionText.includes(highlightText)) {
            const parts = safeQuestion.questionText.split(highlightText);
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
                text={safeQuestion.questionText} 
                mode={isGapMode ? 'gap' : 'plain'}
                revealExpected={isRevealed}
                highlights={evidence?.stem} 
            />
        );
    };

    // Calculate options from SAFE VIEW
    const optionsState = useMemo(() => {
        const ALL_KEYS = ['A', 'B', 'C', 'D', 'E'];
        
        return ALL_KEYS.map(key => {
            const raw = safeQuestion.options[key];
            const clean = sanitizeOptionText(raw as string);
            const isValid = clean.length > 0;
            return { 
                key, 
                text: isValid ? clean : "(Alternativa vazia ou inválida - Verifique o cadastro)", 
                isDisabled: !isValid 
            };
        });
    }, [safeQuestion.options]);

    // Check if the correct answer points to a disabled option
    const isCorrectAnswerInvalid = useMemo(() => {
        if (isJudgementMode) return false;
        const correctOpt = optionsState.find(o => o.key === safeQuestion.correctAnswer);
        return correctOpt ? correctOpt.isDisabled : true; 
    }, [optionsState, safeQuestion.correctAnswer, isJudgementMode]);

    return (
        <div className={`space-y-6 pb-10 ${className}`}>
            <div id="question-start-anchor" className="h-px w-full -mt-2"></div>

            {showMedia && (safeQuestion.questionImage || safeQuestion.questionAudio) && (
                <div className="flex flex-col gap-4 mb-4">
                    {safeQuestion.questionImage && <img src={safeQuestion.questionImage} alt="Questão" className="max-w-full rounded-lg max-h-80 object-contain mx-auto bg-black/20" />}
                    {safeQuestion.questionAudio && <audio controls src={safeQuestion.questionAudio} className="w-full" />}
                </div>
            )}

            {/* Warning Banner for Broken Data */}
            {isCorrectAnswerInvalid && !isJudgementMode && (
                <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg flex items-center gap-3 animate-fade-in mb-4">
                    <ExclamationTriangleIcon className="w-5 h-5 text-rose-500" />
                    <p className="text-xs text-rose-200">
                        <strong>Atenção:</strong> O gabarito desta questão ({safeQuestion.correctAnswer}) aponta para uma alternativa inválida ou vazia. O fallback de recuperação falhou.
                    </p>
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
                                    ? (safeQuestion.correctAnswer === judgementKeys.rightKey 
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
                                    ? (safeQuestion.correctAnswer === judgementKeys.wrongKey 
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
                        {optionsState.map(({ key, text, isDisabled }, index) => {
                            const isEliminated = eliminatedOptions.includes(key);
                            const isSelected = selectedOption === key;
                            const isCorrect = safeQuestion.correctAnswer === key;
                            const highlights = evidence?.options[key]; 
                            
                            const visualLabel = String.fromCharCode(65 + index); // A, B, C... (Fixed Order)
                            
                            let btnClass = "w-full text-left p-3.5 rounded-xl border-2 transition-all flex gap-3 items-start group ";
                            
                            // Style Logic
                            if (isDisabled) {
                                // Invalid Option State
                                btnClass += "bg-black/20 border-white/5 text-slate-600 cursor-not-allowed italic opacity-70";
                            } else if (isEliminated) {
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
                                    onClick={() => !isDisabled && handleOptionClick(key)}
                                    disabled={isDisabled || isRevealed || (isLocked)}
                                    className={btnClass}
                                    title={isDisabled ? "Opção inválida ou vazia no cadastro." : undefined}
                                >
                                    <strong className={`shrink-0 text-base ${!isDisabled && !isRevealed && !isSelected && !isEliminated ? 'text-sky-500 group-hover:text-sky-400' : 'text-current'}`}>{visualLabel})</strong>
                                    <span className="leading-snug pt-0.5 text-sm md:text-base w-full">
                                        <PromptText text={text} highlights={highlights} />
                                    </span>
                                    {isDisabled && <ExclamationTriangleIcon className="w-4 h-4 ml-auto shrink-0 text-slate-600" />}
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
                        question={safeQuestion} 
                        userAnswer={selectedOption} 
                        showTitle={true}
                   />
                </div>
            )}
        </div>
    );
};

export default QuestionViewer;

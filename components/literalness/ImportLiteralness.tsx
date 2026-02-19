
import React, { useState, useMemo, useRef } from 'react';
import { useLiteralnessDispatch, useLiteralnessState } from '../../contexts/LiteralnessContext';
import { useQuestionDispatch } from '../../contexts/QuestionContext';
import { useFlashcardDispatch } from '../../contexts/FlashcardContext';
import { useSettings } from '../../contexts/SettingsContext';
import { LiteralnessCard, Question, Flashcard, LawContentType } from '../../types';
import * as srs from '../../services/srsService';
import { parseLitRefText, ParseDiagnosis, ParseIssue } from '../../services/import/litRefParser';
import { nucleusRepo } from '../../services/repositoryService';
import { 
    CheckCircleIcon, XMarkIcon, CloudIcon, ChevronLeftIcon, 
    ExclamationTriangleIcon, BoltIcon, TrashIcon, ArrowPathIcon
} from '../icons';

interface ImportLiteralnessProps {
    type?: LawContentType;
    onBack?: () => void;
    forcedLawId?: string | null;
}

const ImportLiteralness: React.FC<ImportLiteralnessProps> = ({ type = 'LAW_DRY', onBack }) => {
    const { addBatchCards } = useLiteralnessDispatch();
    const { addBatchQuestions } = useQuestionDispatch();
    const { addBatchFlashcards } = useFlashcardDispatch();
    const { settings } = useSettings();
    const allCards = useLiteralnessState();
    
    const [text, setText] = useState('');
    const [diagnosis, setDiagnosis] = useState<ParseDiagnosis | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // --- ACTIONS ---

    const handleAnalyze = () => {
        if (!text.trim()) return;
        setIsProcessing(true);
        setTimeout(() => {
            const batchId = `BATCH_${Date.now()}`;
            const result = parseLitRefText(text, settings, batchId);
            setDiagnosis(result);
            setIsProcessing(false);
        }, 100); // Async simulation for UI response
    };

    const handleImport = async (mode: 'OVERWRITE' | 'MERGE' | 'SKIP') => {
        if (!diagnosis || !diagnosis.isValid) return;
        setIsProcessing(true);
        
        try {
            const batch = {
                cards: diagnosis.parsedData.nuclei,
                questions: diagnosis.parsedData.questions,
                flashcards: diagnosis.parsedData.flashcards
            };

            // Process based on mode (Logic delegated to Repository to keep UI clean)
            // Note: Repository handles "Overwrite" by replacing children. 
            // "Skip" logic is: filter out existing cards from batch before saving.
            
            if (mode === 'SKIP') {
                const existingIds = new Set(allCards.map(c => c.id));
                batch.cards = batch.cards.filter(c => !existingIds.has(c.id));
                // We also filter children to only include those for new cards
                // (Assuming Skip means "Don't touch existing articles at all")
                const newCardIds = new Set(batch.cards.map(c => c.id));
                batch.questions = batch.questions.filter(q => newCardIds.has(srs.canonicalizeLitRef(q.lawRef)));
                batch.flashcards = batch.flashcards.filter(f => newCardIds.has(srs.resolveLitRef(f)));
            }

            // Use Repository Service for Robust Save (Transactional-ish)
            await nucleusRepo.saveImportBatch(batch);
            
            // Refresh Contexts (The providers effectively reload from DB or we push directly)
            // For now, we push to dispatchers to update UI state immediately
            addBatchCards(batch.cards);
            addBatchQuestions(batch.questions, mode === 'OVERWRITE' ? 'OVERWRITE' : 'MERGE'); 
            addBatchFlashcards(batch.flashcards);

            alert(`Importação concluída (${mode})!\n${batch.cards.length} Artigos processados.`);
            setDiagnosis(null);
            setText('');

        } catch (e: any) {
            alert(`Erro ao salvar: ${e.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    // --- UI HELPERS ---

    const highlightError = (line: number) => {
        if (textareaRef.current) {
            const lines = text.split('\n');
            let start = 0;
            for (let i = 0; i < line - 1; i++) {
                start += lines[i].length + 1; // +1 for newline
            }
            const end = start + lines[line - 1].length;
            
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(start, end);
            textareaRef.current.scrollTop = start / 3; // Approx scroll
        }
    };

    // --- RENDER ---

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-24 animate-fade-in px-4 h-full flex flex-col">
            
            {/* Header */}
            <div className="flex justify-between items-center bg-slate-900/80 p-4 rounded-2xl border border-white/10 backdrop-blur shrink-0">
                <div className="flex items-center gap-3">
                    <CloudIcon className="text-sky-400 w-8 h-8" />
                    <div>
                        <h3 className="text-xl font-black text-white italic tracking-tighter">Importador Lei Seca</h3>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Parser v2.0 • Blocos • Validação</p>
                    </div>
                </div>
                {onBack && <button onClick={onBack} className="p-2 bg-white/5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white"><XMarkIcon className="w-5 h-5"/></button>}
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
                
                {/* LEFT: Editor */}
                <div className="flex flex-col gap-4 h-full">
                    <div className="flex-1 bg-slate-900 border border-white/10 rounded-2xl p-1 relative">
                        <textarea 
                            ref={textareaRef}
                            value={text} 
                            onChange={(e) => { setText(e.target.value); if(diagnosis) setDiagnosis(null); }} 
                            className="w-full h-full bg-transparent p-4 text-xs font-mono text-sky-100 outline-none resize-none leading-relaxed custom-scrollbar whitespace-pre" 
                            placeholder="Cole aqui seu conteúdo (LIT_REF: ...)"
                            spellCheck={false}
                        />
                        {/* Line Numbers Overlay could go here if needed */}
                    </div>
                    <div className="flex justify-between items-center shrink-0">
                         <button onClick={() => setText('')} className="text-slate-500 hover:text-rose-500 p-2"><TrashIcon className="w-5 h-5"/></button>
                         <button 
                            onClick={handleAnalyze} 
                            disabled={!text.trim() || isProcessing}
                            className="bg-sky-600 hover:bg-sky-500 text-white font-black px-8 py-3 rounded-xl shadow-lg transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                         >
                             {isProcessing ? <ArrowPathIcon className="w-4 h-4 animate-spin"/> : <BoltIcon className="w-4 h-4"/>}
                             ANALISAR TEXTO
                         </button>
                    </div>
                </div>

                {/* RIGHT: Diagnostics & Actions */}
                <div className="flex flex-col gap-4 h-full overflow-hidden">
                    {diagnosis ? (
                        <div className="flex flex-col h-full bg-slate-900/50 border border-white/10 rounded-2xl overflow-hidden">
                            {/* Stats Header */}
                            <div className="p-4 border-b border-white/5 bg-slate-900/80 grid grid-cols-3 gap-2 text-center shrink-0">
                                <div className="p-2 bg-white/5 rounded-lg"><span className="block text-xl font-black text-white">{diagnosis.stats.articles}</span><span className="text-[8px] uppercase text-slate-500 font-bold">Artigos</span></div>
                                <div className="p-2 bg-white/5 rounded-lg"><span className="block text-xl font-black text-sky-400">{diagnosis.stats.questions}</span><span className="text-[8px] uppercase text-slate-500 font-bold">Questões</span></div>
                                <div className="p-2 bg-white/5 rounded-lg"><span className="block text-xl font-black text-emerald-400">{diagnosis.stats.flashcards + diagnosis.stats.pairs}</span><span className="text-[8px] uppercase text-slate-500 font-bold">Cards</span></div>
                            </div>

                            {/* Issues List */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                                {diagnosis.issues.length === 0 ? (
                                    <div className="text-center py-10 opacity-50">
                                        <CheckCircleIcon className="w-12 h-12 text-emerald-500 mx-auto mb-2"/>
                                        <p className="text-sm font-bold text-emerald-400">Nenhum erro encontrado.</p>
                                    </div>
                                ) : (
                                    diagnosis.issues.map((issue, idx) => (
                                        <div 
                                            key={idx} 
                                            onClick={() => highlightError(issue.line)}
                                            className={`p-3 rounded-xl border cursor-pointer hover:bg-white/5 transition-all ${issue.severity === 'ERROR' ? 'bg-rose-500/10 border-rose-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${issue.severity === 'ERROR' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-black'}`}>
                                                    {issue.severity}
                                                </span>
                                                <span className="text-[10px] font-mono text-slate-500">Linha {issue.line}</span>
                                            </div>
                                            <p className="text-xs text-white font-medium mb-1"><span className="opacity-50">[{issue.block}]</span> {issue.message}</p>
                                            <p className="text-[10px] text-sky-400 font-bold">💡 {issue.suggestion}</p>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div className="p-4 border-t border-white/5 bg-slate-900/80 shrink-0">
                                {diagnosis.isValid ? (
                                    <div className="grid grid-cols-3 gap-2">
                                        <button onClick={() => handleImport('SKIP')} className="py-3 rounded-xl border border-white/10 hover:bg-white/5 text-slate-400 font-bold text-[10px] uppercase">Ignorar Existentes</button>
                                        <button onClick={() => handleImport('MERGE')} className="py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] uppercase shadow-lg">Mesclar (Update)</button>
                                        <button onClick={() => handleImport('OVERWRITE')} className="py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-[10px] uppercase shadow-lg">Sobrescrever</button>
                                    </div>
                                ) : (
                                    <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-center">
                                        <p className="text-xs font-bold text-rose-400">Corrija os erros acima para importar.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-30 border-2 border-dashed border-slate-700 rounded-2xl">
                            <BoltIcon className="w-16 h-16 mb-4 text-slate-500"/>
                            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Aguardando Análise</p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default ImportLiteralness;

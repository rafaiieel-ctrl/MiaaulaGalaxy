import { LiteralnessCard, Question, Flashcard, AppSettings } from '../../types';
import * as srs from '../srsService';
import * as idGen from '../idGenerator';
import { buildReadingSteps } from '../readingParser';
import { sanitizeOptionText } from '../questionParser';
import { parseDiagnosisMap } from '../../utils/feedbackFormatters';
import { normalizeDiscipline } from '../taxonomyService';

// --- TYPES ---

export type ParseSeverity = 'ERROR' | 'WARNING';

export interface ParseIssue {
    line: number;
    severity: ParseSeverity;
    block: string;
    field: string;
    message: string;
    suggestion: string;
}

export interface ParseDiagnosis {
    isValid: boolean;
    issues: ParseIssue[];
    stats: {
        articles: number;
        questions: number;
        flashcards: number;
        pairs: number;
        gaps: number;
    };
    parsedData: {
        nuclei: any[];
        questions: any[];
        flashcards: any[];
        gaps: any[];
    }
}

// --- CONSTANTS ---

const STATES = {
    NONE: 'NONE',
    HEADER: 'HEADER',
    QUESTION: 'QUESTION',
    FLASHCARD: 'FLASHCARD',
    PAIR: 'PAIR'
};

const REQUIRED_HEADER_FIELDS = ['LIT_REF', 'LAW_ID', 'ARTICLE'];
const REQUIRED_QUESTION_FIELDS = ['Q_TEXT', 'CORRECT'];
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'];

// --- HELPERS ---

const normalizeLine = (line: string) => line.replace(/^\uFEFF/, '').replace(/\r$/, '');

const extractKey = (line: string): { key: string, value: string } | null => {
    const match = line.match(/^([A-Z0-9_]+)(?:_\d+)?\s*[:=]\s*(.*)$/);
    if (match) {
        return { key: match[1].toUpperCase(), value: match[2].trim() };
    }
    return null;
};

// --- MAIN PARSER (State Machine) ---

export const parseLitRefText = (text: string, settings: AppSettings, batchId: string): ParseDiagnosis => {
    const lines = text.split('\n');
    const issues: ParseIssue[] = [];
    
    // Output Containers
    const nuclei: any[] = [];
    const questions: any[] = [];
    const flashcards: any[] = []; // Includes pairs

    // State Variables
    let state = STATES.NONE;
    let currentObj: any = {};
    let currentLineStart = 0;
    
    // Accumulator for multiline values
    let lastKey: string | null = null;
    
    // Context Tracking (for linking children)
    let activeLitRef: string | null = null;
    let activeLawId: string = 'GERAL';
    let activeTopic: string = 'Geral';
    let activeArticle: string = '';

    const flushObject = () => {
        if (!currentObj) return;
        
        if (state === STATES.HEADER) {
            // Validate Header
            if (!currentObj.LIT_REF) {
                issues.push({ line: currentLineStart, severity: 'ERROR', block: 'HEADER', field: 'LIT_REF', message: 'Artigo sem LIT_REF.', suggestion: 'Adicione "LIT_REF: CODIGO_ART_XX"' });
            } else {
                activeLitRef = srs.canonicalizeLitRef(currentObj.LIT_REF);
                activeLawId = currentObj.LAW_ID || activeLawId;
                activeTopic = currentObj.TOPIC || activeTopic;
                activeArticle = currentObj.ARTICLE || activeLitRef;

                // Push to nuclei
                nuclei.push({
                    ...currentObj,
                    id: activeLitRef,
                    lawId: activeLawId,
                    article: activeArticle,
                    topic: activeTopic,
                    importBatchId: batchId
                });
            }
        } else if (state === STATES.QUESTION) {
            if (!activeLitRef) {
                issues.push({ line: currentLineStart, severity: 'ERROR', block: 'QUESTION', field: 'CONTEXT', message: 'Questão fora de um artigo (Orphan).', suggestion: 'Mova esta questão para baixo de um LIT_REF.' });
                return;
            }
            
            const qRef = currentObj.Q_REF || `Q-${Date.now()}-${Math.random()}`;
            
            // Validate Options & Correct
            const opts: any = {};
            let hasEmptyOption = false;
            
            OPTION_KEYS.forEach(k => {
                // Check raw keys A, B... or OPT_A, OPT_B...
                const val = currentObj[k] || currentObj[`OPT_${k}`];
                if (val) {
                    opts[k] = sanitizeOptionText(val);
                } else if (currentObj[k] === '') { // Explicitly empty
                     hasEmptyOption = true;
                     issues.push({ line: currentLineStart, severity: 'ERROR', block: qRef, field: k, message: `Alternativa ${k} está vazia.`, suggestion: 'Preencha o texto ou remova a linha.' });
                }
            });

            // Validate Correct
            const correct = (currentObj.CORRECT || currentObj.ANSWER || '').trim().toUpperCase().charAt(0);
            if (!correct) {
                issues.push({ line: currentLineStart, severity: 'ERROR', block: qRef, field: 'CORRECT', message: 'Gabarito ausente.', suggestion: 'Adicione "CORRECT: X"' });
            } else if (!opts[correct] && !currentObj.TYPE?.includes('C/E')) {
                 issues.push({ line: currentLineStart, severity: 'ERROR', block: qRef, field: 'CORRECT', message: `Gabarito ${correct} aponta para opção inexistente.`, suggestion: `Verifique se a opção ${correct} existe.` });
            }

            questions.push({
                ...currentObj,
                id: idGen.generateQuestionKey(qRef),
                questionRef: qRef,
                questionText: currentObj.Q_TEXT || currentObj.QUESTION_TEXT || '',
                correctAnswer: correct,
                options: opts,
                lawRef: activeLitRef,
                subject: activeLawId,
                topic: activeTopic
            });

        } else if (state === STATES.FLASHCARD || state === STATES.PAIR) {
             if (!activeLitRef) {
                issues.push({ line: currentLineStart, severity: 'ERROR', block: 'FLASHCARD', field: 'CONTEXT', message: 'Item fora de um artigo.', suggestion: 'Mova para baixo de um LIT_REF.' });
                return;
            }
            
            const ref = currentObj.FC_REF || currentObj.PAIR_REF || `FC-${Math.random()}`;
            if (!currentObj.FRONT || !currentObj.BACK) {
                 issues.push({ line: currentLineStart, severity: 'ERROR', block: ref, field: 'FRONT/BACK', message: 'Flashcard incompleto.', suggestion: 'Adicione FRONT e BACK.' });
            }
            
            flashcards.push({
                ...currentObj,
                id: ref,
                front: currentObj.FRONT,
                back: currentObj.BACK,
                discipline: activeLawId,
                topic: activeTopic,
                tags: [activeLitRef, state === STATES.PAIR ? 'pair-match' : 'literalness'],
                litRef: activeLitRef,
                type: state
            });
        }
    };

    // --- LINE ITERATION ---

    for (let i = 0; i < lines.length; i++) {
        const line = normalizeLine(lines[i]).trim();
        const lineNum = i + 1;

        if (!line || line.startsWith('#') || line.startsWith('---')) continue;

        // Detect Block Starters
        if (line.startsWith('LIT_REF:')) {
            flushObject();
            state = STATES.HEADER;
            currentObj = {};
            currentLineStart = lineNum;
            lastKey = null;
        } else if (line.startsWith('Q_REF:')) {
            flushObject();
            state = STATES.QUESTION;
            currentObj = {};
            currentLineStart = lineNum;
            lastKey = null;
        } else if (line.startsWith('FC_REF:')) {
            flushObject();
            state = STATES.FLASHCARD;
            currentObj = {};
            currentLineStart = lineNum;
            lastKey = null;
        } else if (line.startsWith('PAIR_REF:')) {
            flushObject();
            state = STATES.PAIR;
            currentObj = {};
            currentLineStart = lineNum;
            lastKey = null;
        }

        // Parse Key-Value
        const kv = extractKey(line);
        if (kv) {
            // Special handling for Phase 2 indexed keys (PHASE2_LACUNA_01)
            // We strip the suffix for the key name in parsing, but keep full key in object to map later
            currentObj[kv.key] = kv.value;
            lastKey = kv.key;
        } else if (lastKey) {
            // Multiline append
            currentObj[lastKey] += '\n' + line;
        }
    }
    
    // Flush last object
    flushObject();

    // --- TRANSFORM & COUNT ---
    
    const finalCards: LiteralnessCard[] = [];
    const finalQuestions: Question[] = [];
    const finalFlashcards: Flashcard[] = [];
    const finalGaps: any[] = []; // Raw gap objects

    const today = srs.todayISO();

    // 1. Process Cards & Gaps
    nuclei.forEach(n => {
        // Extract Gaps from Nucleus fields (PHASE2_LACUNA_XX)
        const cardGaps: any[] = [];
        const gapKeys = Object.keys(n).filter(k => k.startsWith('PHASE2_LACUNA_'));
        
        gapKeys.forEach(k => {
            const suffix = k.replace('PHASE2_LACUNA_', ''); // e.g. "01"
            const text = n[k];
            
            // Check placeholders
            const matches = text.match(/\{\{.+?\}\}/g);
            if (!matches) {
                 issues.push({ line: 0, severity: 'ERROR', block: n.id, field: k, message: `Lacuna ${suffix} sem placeholder {{...}}.`, suggestion: 'Marque a resposta com {{ }}' });
            } else if (matches.length > 1) {
                 issues.push({ line: 0, severity: 'ERROR', block: n.id, field: k, message: `Lacuna ${suffix} com múltiplos placeholders.`, suggestion: 'Use apenas um {{...}} por lacuna.' });
            }

            const correctLetter = (n[`PHASE2_CORRECT_${suffix}`] || 'A').trim().toUpperCase();
            if (!OPTION_KEYS.includes(correctLetter)) {
                 issues.push({ line: 0, severity: 'ERROR', block: n.id, field: `PHASE2_CORRECT_${suffix}`, message: `Gabarito ${correctLetter} inválido.`, suggestion: 'Use A, B, C, D ou E.' });
            }

            const opts = {
                A: sanitizeOptionText(n[`PHASE2_OPT_A_${suffix}`]),
                B: sanitizeOptionText(n[`PHASE2_OPT_B_${suffix}`]),
                C: sanitizeOptionText(n[`PHASE2_OPT_C_${suffix}`]),
                D: sanitizeOptionText(n[`PHASE2_OPT_D_${suffix}`]),
                E: sanitizeOptionText(n[`PHASE2_OPT_E_${suffix}`]),
            };
            
            // Check if correct option exists
            // @ts-ignore
            if (!opts[correctLetter]) {
                 issues.push({ line: 0, severity: 'ERROR', block: n.id, field: `PHASE2_OPT_${correctLetter}_${suffix}`, message: `Opção correta vazia.`, suggestion: 'Preencha a alternativa.' });
            }

            const gapId = idGen.makeDeterministicId(n.id, 'LACUNA', suffix);
            
            const gapObj = {
                id: gapId,
                litRef: n.id,
                type: 'LACUNA',
                payload: {
                    lacuna_text: text,
                    correct_letter: correctLetter,
                    options: opts
                }
            };
            cardGaps.push({
                 id: gapId,
                 text: text,
                 correct: correctLetter,
                 options: opts,
                 questionRef: `GAP-${suffix}`
            });
            finalGaps.push(gapObj);
        });

        const card: LiteralnessCard = {
            id: n.id,
            lawId: normalizeDiscipline(n.lawId),
            article: n.article,
            topic: n.topic,
            phase1Full: n.PHASE1_FULL || '',
            partsSummary: n.PARTS_SUMMARY || n.RESUMO_POR_PARTES || '',
            keywordsProva: n.KEYWORDS_PROVA || '',
            riscoFcc: n.RISCO_FCC || '',
            gancho: n.GANCHO_MNEMONICO || '',
            storytelling: n.STORYTELLING || '',
            feynmanExplanation: n.FEYNMAN || '',
            createdAt: today, nextReviewDate: today, lastReviewedAt: today, masteryScore: 0, totalAttempts: 0,
            stability: settings.srsV2.S_default_days,
            batteryProgress: 0, progressionLevel: 0, userNotes: '',
            contentType: 'LAW_DRY', importBatchId: batchId,
            extraGaps: cardGaps // Hydrated here for preview
        };
        card.studyFlow = buildReadingSteps(card);
        finalCards.push(card);
    });

    // 2. Process Questions
    questions.forEach(q => {
        const newQ: Question = {
            id: idGen.makeDeterministicId(q.lawRef, 'QUESTION', q.questionRef),
            questionRef: q.questionRef,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: q.correctAnswer,
            subject: normalizeDiscipline(q.subject),
            topic: q.topic,
            lawRef: q.lawRef,
            // ... defaults
            explanation: q.EXPLANATION || '',
            explanationTech: q.EXPLANATION_TECH || '',
            explanationStory: q.EXPLANATION_STORY || '',
            wrongDiagnosis: q.WRONG_DIAGNOSIS || '',
            distractorProfile: parseDiagnosisMap(q.DISTRACTOR_PROFILE),
            wrongDiagnosisMap: parseDiagnosisMap(q.WRONG_DIAGNOSIS_MAP),
            guiaTrapscan: q.GUIA_TRAPSCAN || '',
            keyDistinction: q.KEY_DISTINCTION || '',
            anchorText: q.ANCHOR_TEXT || '',
            
            importBatchId: batchId,
            createdAt: today, nextReviewDate: today, totalAttempts: 0, masteryScore: 0,
            stability: settings.srsV2.S_default_days, attemptHistory: [],
            questionType: q.TYPE || 'Literalidade',
            hotTopic: !!q.HOT, isCritical: !!q.CRIT, isFundamental: !!q.FUND,
            lastAttemptDate: '', errorCount: 0, timeSec: 0, selfEvalLevel: 0,
            willFallExam: false, srsStage: 0, correctStreak: 0, lastWasCorrect: false, recentError: 0, comments: ''
        } as unknown as Question;
        
        finalQuestions.push(newQ);
    });

    // 3. Process Flashcards/Pairs
    flashcards.forEach(f => {
        const isPair = f.type === 'PAIR';
        const tags = [f.litRef, isPair ? 'pair-match' : 'literalness'].filter(Boolean);
        
        const newFc: Flashcard = {
            id: idGen.makeDeterministicId(f.litRef, isPair ? 'PAIR' : 'FLASHCARD', f.FC_REF || f.PAIR_REF),
            front: f.FRONT,
            back: f.BACK,
            discipline: normalizeDiscipline(f.discipline),
            topic: f.topic,
            tags: tags,
            type: 'basic',
            importBatchId: batchId,
            createdAt: today, updatedAt: today, nextReviewDate: today,
            masteryScore: 0, stability: settings.srsV2.S_default_days,
            totalAttempts: 0, attemptHistory: [], masteryHistory: [],
            hotTopic: false, isCritical: false, isFundamental: false,
            lastWasCorrect: false, recentError: 0, correctStreak: 0, srsStage: 0,
            lastAttemptDate: '', pairMatchPlayed: false, timeSec: 0, selfEvalLevel: 0, comments: f.COMMENTS || ''
        } as unknown as Flashcard;
        
        finalFlashcards.push(newFc);
    });

    return {
        isValid: issues.filter(i => i.severity === 'ERROR').length === 0,
        issues,
        stats: {
            articles: finalCards.length,
            questions: finalQuestions.length,
            flashcards: finalFlashcards.filter(f => !f.tags.includes('pair-match')).length,
            pairs: finalFlashcards.filter(f => f.tags.includes('pair-match')).length,
            gaps: finalGaps.length
        },
        parsedData: {
            nuclei: finalCards,
            questions: finalQuestions,
            flashcards: finalFlashcards,
            gaps: finalGaps
        }
    };
};

export const runImportSelfTest = async (): Promise<any> => {
    // Placeholder required for build
    return {};
}

// Stub for backward compatibility if needed, though we should replace usages
export const generateImportReport = () => {};
import { LiteralnessCard, Question, Flashcard, AppSettings } from '../../types';
import * as srs from '../srsService';
import * as idGen from '../idGenerator';
import { buildReadingSteps } from '../readingParser';
import { sanitizeOptionText } from '../questionParser';
import { parseDiagnosisMap } from '../../utils/feedbackFormatters';

export interface ImportResult {
    batchId: string;
    cards: LiteralnessCard[];
    questions: Question[];
    flashcards: Flashcard[];
    gaps: any[]; 
    stats: {
        cards: number;
        questions: number;
        flashcards: number;
        pairs: number;
        gaps: number;
    };
    errors: string[];
}

export interface ImportReport {
    litRef: string;
    status: 'SUCCESS' | 'FAILED';
    errors: string[];
    warnings: string[];
    counts: {
        lacunas: number;
        questions: number;
        flashcards: number;
        pairs: number;
        gaps: number;
    };
    detectedGaps: string[];
}

/**
 * Helper: Parses a raw block of text into a dictionary of keys/values.
 * Handles multiline values.
 */
const parseBlock = (blockText: string): Record<string, string> => {
    const lines = blockText.split('\n');
    const result: Record<string, string> = {};
    let currentKey: string | null = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Match "KEY: Value" or "OPT_A: Value"
        // We look for keys at the START of the line to avoid false positives inside text.
        // Valid keys: Uppercase letters, numbers, underscores.
        const match = trimmed.match(/^([A-Z0-9_]+)\s*[:=]\s*(.*)$/);

        if (match) {
            const key = match[1].toUpperCase();
            const value = match[2];
            result[key] = value;
            currentKey = key;
        } else if (currentKey) {
            // Append to previous key (multiline support)
            result[currentKey] += '\n' + trimmed;
        }
    }
    return result;
};

/**
 * MIIAULA ROBUST BLOCK PARSER
 * 1. Splits text into logical blocks (Card, Question, Flashcard).
 * 2. Parses each block independently to avoid context leaks.
 * 3. Enforces OPT_A...E structure.
 */
export const parseOfficialStrict = (text: string, settings: AppSettings): { 
    batchId: string, 
    nuclei: any[], 
    contents: any[],
    reports: ImportReport[] 
} => {
    const batchId = `BATCH_${Date.now()}`;
    const nuclei: any[] = [];
    const contents: any[] = [];
    const reports: ImportReport[] = [];
    const errors: string[] = [];

    // 1. Split into Blocks based on primary keys
    // We split by lines that START with specific headers to define block boundaries
    const rawBlocks = text.split(/(?=^(?:LIT_REF|Q_REF|FC_REF|PAIR_REF):)/m).filter(b => b.trim().length > 0);

    let currentCardId: string | null = null;
    let currentLawId: string = 'GERAL';
    let currentTopic: string = 'Geral';

    // Helper to create report if not exists
    const getOrCreateReport = (ref: string) => {
        let rep = reports.find(r => r.litRef === ref);
        if (!rep) {
            rep = {
                litRef: ref,
                status: 'SUCCESS',
                errors: [],
                warnings: [],
                counts: { lacunas: 0, questions: 0, flashcards: 0, pairs: 0, gaps: 0 },
                detectedGaps: []
            };
            reports.push(rep);
        }
        return rep;
    };

    for (const block of rawBlocks) {
        const fields = parseBlock(block);

        // --- TYPE: LITERALNESS CARD (ARTICLE) ---
        if (fields.LIT_REF) {
            const litRef = srs.canonicalizeLitRef(fields.LIT_REF);
            const lawId = fields.LAW_ID || currentLawId;
            
            currentCardId = idGen.generateDocKey(lawId, litRef);
            currentLawId = lawId;
            currentTopic = fields.TOPIC || currentTopic;

            nuclei.push({
                ...fields,
                id: currentCardId,
                lawId: currentLawId, // Normalized in object creation later
                article: fields.ARTICLE || litRef,
                importBatchId: batchId
            });
            
            getOrCreateReport(currentCardId);
        }

        // --- TYPE: QUESTION ---
        else if (fields.Q_REF) {
            if (!currentCardId) {
                errors.push(`Questão ${fields.Q_REF} ignorada: Nenhum LIT_REF definido antes dela.`);
                continue;
            }

            const qRef = fields.Q_REF;
            const report = getOrCreateReport(currentCardId);
            
            // 1. Normalize Options (The Golden Rule)
            // Priority: OPT_A > A
            const opts: Record<string, string> = {};
            const keys = ['A', 'B', 'C', 'D', 'E'];
            
            keys.forEach(k => {
                let val = fields[`OPT_${k}`] || fields[k];
                if (val) opts[k] = sanitizeOptionText(val);
            });

            // 2. Normalize Correct Answer
            let correct = (fields.CORRECT || fields.ANSWER || '').trim().toUpperCase().charAt(0);

            // 3. Validation
            const isCebraspe = (fields.TYPE || '').includes('C/E') || (fields.BANK || '').toUpperCase().includes('CEBRASPE');
            let isValid = true;

            if (!fields.Q_TEXT) {
                report.errors.push(`${qRef}: Enunciado (Q_TEXT) vazio.`);
                isValid = false;
            }

            if (!correct) {
                 report.errors.push(`${qRef}: Gabarito (CORRECT) não definido.`);
                 isValid = false;
            }

            if (isCebraspe) {
                // Auto-fill C/E options if missing
                if (!opts.A) opts.A = 'Certo';
                if (!opts.B) opts.B = 'Errado';
                // Ensure C-E are empty
                opts.C = ''; opts.D = ''; opts.E = '';
            } else {
                // FCC / Standard: Require A-E
                const missingOpts = keys.filter(k => !opts[k]);
                if (missingOpts.length > 0) {
                    // Allow 4 options if standard for bank, but warn if < 4
                    if (missingOpts.length > 1) { // Tolerate missing E only
                        report.errors.push(`${qRef}: Alternativas faltando (${missingOpts.join(',')}).`);
                        isValid = false;
                    }
                }
                
                // Validate Correct points to existing option
                if (correct && !opts[correct]) {
                    report.errors.push(`${qRef}: Gabarito '${correct}' aponta para opção vazia.`);
                    isValid = false;
                }
            }

            if (isValid) {
                const qId = idGen.generateQuestionKey(qRef); // Stable ID based on Q_REF
                contents.push({
                    id: qId,
                    litRef: currentCardId,
                    type: 'QUESTION',
                    payload: {
                        ...fields,
                        id: qId,
                        questionRef: qRef,
                        questionText: fields.Q_TEXT,
                        options: opts, // Guaranteed clean object { A:..., B:... }
                        correctAnswer: correct,
                        lawRef: currentCardId,
                        // Clean legacy fields that might leak into logic
                        A: undefined, B: undefined, C: undefined, D: undefined, E: undefined,
                        OPT_A: undefined, OPT_B: undefined, OPT_C: undefined, OPT_D: undefined, OPT_E: undefined
                    }
                });
                report.counts.questions++;
            } else {
                report.status = 'FAILED';
            }
        }

        // --- TYPE: FLASHCARD / PAIR ---
        else if (fields.FC_REF || fields.PAIR_REF) {
            if (!currentCardId) continue;
            
            const ref = fields.FC_REF || fields.PAIR_REF;
            const type = fields.PAIR_REF ? 'PAIR' : 'FLASHCARD';
            const report = getOrCreateReport(currentCardId);

            contents.push({
                id: idGen.makeDeterministicId(currentCardId, type, ref),
                litRef: currentCardId,
                type: type,
                payload: {
                    ...fields,
                    id: ref,
                    fc_ref: ref,
                    pair_ref: ref,
                    front: fields.FRONT,
                    back: fields.BACK,
                    lawRef: currentCardId
                }
            });

            if (type === 'PAIR') report.counts.pairs++;
            else report.counts.flashcards++;
        }
        
        // --- TYPE: GAPS (PHASE2_LACUNA...) ---
        // Note: The original parser handled GAPS inside the Nucleus block loop or via regex.
        // For block parsing, GAPS might be separate or embedded in LIT_REF block. 
        // The `parseBlock` helper captures keys like PHASE2_LACUNA_01.
        // We need to extract them from the LIT_REF block payload in the `nuclei` processing step, 
        // or process them here if they appear as separate blocks (unlikely in current format).
        // Since `nuclei` items contain all fields from the block, we can process gaps post-hoc from the nuclei array.
    }

    // Process Gaps from Nuclei Fields
    nuclei.forEach(n => {
        const report = getOrCreateReport(n.id);
        const gapKeys = Object.keys(n).filter(k => k.startsWith('PHASE2_LACUNA_'));
        
        gapKeys.forEach(k => {
            const suffix = k.replace('PHASE2_LACUNA_', ''); // e.g. "01"
            const text = n[k];
            
            // Extract options and correct from flat fields
            const opts = {
                A: sanitizeOptionText(n[`PHASE2_OPT_A_${suffix}`]),
                B: sanitizeOptionText(n[`PHASE2_OPT_B_${suffix}`]),
                C: sanitizeOptionText(n[`PHASE2_OPT_C_${suffix}`]),
                D: sanitizeOptionText(n[`PHASE2_OPT_D_${suffix}`]),
                E: sanitizeOptionText(n[`PHASE2_OPT_E_${suffix}`]),
            };
            const correct = (n[`PHASE2_CORRECT_${suffix}`] || 'A').trim().toUpperCase();

            if (text) {
                const gapId = idGen.makeDeterministicId(n.id, 'LACUNA', suffix);
                contents.push({
                    id: gapId,
                    litRef: n.id,
                    type: 'LACUNA',
                    idx: parseInt(suffix) || 0,
                    payload: {
                        lacuna_text: text,
                        correct_letter: correct,
                        options: opts,
                        // Helper for blank text
                        blank_text: text.replace(/{{\s*.*?\s*}}/, '__________')
                    }
                });
                report.counts.lacunas++;
            }
        });
    });

    // Pass any global errors to the first report or a general bucket
    if (errors.length > 0 && reports.length > 0) {
        reports[0].errors.push(...errors);
    }

    return { batchId, nuclei, contents, reports };
};

export function parseLitRefText(text: string, settings: AppSettings, batchId: string, lawId?: string, forceLawId?: boolean): ImportResult {
    const { nuclei, contents, reports } = parseOfficialStrict(text, settings);
    const errors: string[] = [];
    reports.forEach(r => errors.push(...r.errors));

    const today = srs.todayISO();

    const gaps = contents.filter(c => c.type === 'LACUNA').map(c => ({
        id: c.id,
        litRef: c.litRef,
        type: 'LACUNA',
        payload: c.payload
    }));

    const cards: LiteralnessCard[] = nuclei.map(n => {
        const cardId = n.id;
        // Find gaps belonging to this card
        const cardGaps = gaps.filter(g => srs.canonicalizeLitRef(g.litRef) === srs.canonicalizeLitRef(cardId)).map(g => ({
             id: g.id,
             text: g.payload.lacuna_text || g.payload.text,
             correct: g.payload.correct_letter || g.payload.correct || 'A',
             options: g.payload.options || { A: 'Erro' },
             questionRef: `GAP-${g.payload.idx || '?'}`
        }));

        const card: LiteralnessCard = {
            id: cardId,
            lawId: forceLawId && lawId ? lawId : (n.lawId || lawId || 'Geral'), // Use n.lawId derived in parser
            article: n.ARTICLE || n.article || 'Artigo',
            topic: n.TOPIC || 'Geral',
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
            extraGaps: cardGaps 
        };
        card.studyFlow = buildReadingSteps(card);
        return card;
    });

    const questions: Question[] = contents.filter(c => c.type === 'QUESTION').map(c => {
        const p = c.payload;
        
        return {
            id: c.id,
            questionRef: p.questionRef,
            questionText: p.questionText,
            options: p.options, // Already sanitized in parser
            correctAnswer: p.correctAnswer,
            
            explanation: p.EXPLANATION || '',
            explanationTech: p.EXPLANATION_TECH || '',
            explanationStory: p.EXPLANATION_STORY || '',
            feynmanQuestions: p.PERGUNTAS_FEYNMAN || '',
            
            guiaTrapscan: p.GUIA_TRAPSCAN || '',
            keyDistinction: p.KEY_DISTINCTION || '',
            anchorText: p.ANCHOR_TEXT || '',
            
            wrongDiagnosis: p.WRONG_DIAGNOSIS || '',
            // Map strings to objects if needed (Parser already did basic map for options, these might be strings)
            distractorProfile: parseDiagnosisMap(p.DISTRACTOR_PROFILE), 
            wrongDiagnosisMap: parseDiagnosisMap(p.WRONG_DIAGNOSIS_MAP),

            subject: p.DISCIPLINE || cards.find(card => card.id === c.litRef)?.lawId || 'Geral',
            topic: p.TOPIC || cards.find(card => card.id === c.litRef)?.article || 'Geral',
            lawRef: c.litRef,
            
            importBatchId: batchId,
            totalAttempts: 0, masteryScore: 0, attemptHistory: [],
            stability: settings.srsV2.S_default_days, nextReviewDate: today,
            createdAt: today, lastAttemptDate: '', errorCount: 0, timeSec: 0,
            selfEvalLevel: 0, willFallExam: false, srsStage: 0, correctStreak: 0,
            srsVersion: 2, sequenceNumber: 0, comments: '', 
            questionType: p.TYPE || 'Literalidade',
            
            hotTopic: !!p.HOT,
            isCritical: !!p.CRIT,
            isFundamental: !!p.FUND
        } as unknown as Question;
    });

    const flashcards: Flashcard[] = contents.filter(c => c.type === 'FLASHCARD' || c.type === 'PAIR').map(c => {
        const p = c.payload;
        const tags = p.TAGS ? p.TAGS.split(',').map((t:string)=>t.trim()) : [];
        if (c.type === 'PAIR' && !tags.includes('pair-match')) tags.push('pair-match');
        if (!tags.includes(c.litRef)) tags.push(c.litRef);

        return {
            id: c.id,
            front: p.FRONT || 'Frente Vazia',
            back: p.BACK || 'Verso Vazio',
            discipline: p.DISCIPLINE || cards.find(card => card.id === c.litRef)?.lawId || 'Geral',
            topic: p.TOPIC_TITLE || cards.find(card => card.id === c.litRef)?.article || 'Geral',
            tags: tags,
            type: 'basic',
            importBatchId: batchId, totalAttempts: 0, masteryScore: 0,
            stability: settings.srsV2.S_default_days, nextReviewDate: today,
            createdAt: today, updatedAt: today, lastAttemptDate: '',
            timeSec: 0, selfEvalLevel: 0, attemptHistory: [], masteryHistory: [],
            pairMatchPlayed: false, comments: ''
        } as unknown as Flashcard;
    });

    return {
        batchId, cards, questions, flashcards, gaps,
        stats: {
            cards: cards.length,
            questions: questions.length,
            flashcards: flashcards.filter(f => !f.tags.includes('pair-match')).length,
            pairs: flashcards.filter(f => f.tags.includes('pair-match')).length,
            gaps: gaps.length
        },
        errors
    };
}

export function enforceTargetLinkage(result: ImportResult, targetId: string): ImportResult {
    const canon = srs.canonicalizeLitRef(targetId);
    return {
        ...result,
        questions: (result.questions || []).map(q => ({ ...q, lawRef: canon })),
        flashcards: (result.flashcards || []).map(f => ({ ...f, tags: [...new Set([...(f.tags || []), canon])] })),
        // Also relink gaps if we were appending
        gaps: (result.gaps || []).map(g => ({ ...g, litRef: canon, id: idGen.makeDeterministicId(canon, 'LACUNA', g.payload.idx || 99) }))
    };
}

export function cleanBatchForExport(batch: any): any { return batch; }

export async function runImportSelfTest(): Promise<any> {
    const testText = `LIT_REF: TEST_01\nLAW_ID: TEST\nARTICLE: Art 1\nPHASE1_FULL: Texto\n\nQ_REF: Q1\nQ_TEXT: T?\nOPT_A: Sim\nOPT_B: Não\nCORRECT: A`;
    const mockSettings: any = { srsV2: { S_default_days: 1 } };
    const result = parseLitRefText(testText, mockSettings, 'TEST_BATCH');
    return { parseResult: result, auditReport: [] };
}
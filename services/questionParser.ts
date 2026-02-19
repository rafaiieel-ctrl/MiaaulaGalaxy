
import { Question } from '../types';

export interface ParsedQuestionContent {
    stem: string;
    options: { [key: string]: string | undefined };
}

/**
 * Sanitizes option text to remove Metadata leaks (P1=..., P7=..., GUIA_TRAPSCAN).
 * Defense Layer 1 & 2.
 */
export function sanitizeOptionText(text: string | undefined): string {
    if (!text) return '';
    
    let clean = text.trim();

    // 1. Immediate rejection of known bad patterns (Metadata leaks that look like options)
    const lower = clean.toLowerCase();
    if (lower === 'correta' || lower === 'incorreta' || lower.startsWith('erradas=') || lower.startsWith('fechamento=')) {
        return ''; // Mark as invalid/empty
    }

    // 2. Remove trailing metadata tags
    const METADATA_LEAK_REGEX = /(?:^|[;\s]+)(?:P[0-7]\s*[=:]|GUIA_TRAPSCAN|TRAPSCAN_EXIGIDO|WRONG_DIAGNOSIS|Erradas=|Fechamento=)[\s\S]*$/i;
    clean = clean.replace(METADATA_LEAK_REGEX, '');
    
    return clean.replace(/[;]+$/, '').trim();
}

/**
 * Robust parser to extract options from raw text.
 * Uses strict state machine to prevent reading options from Explanation blocks.
 */
export function parseQuestionText(rawText: string): ParsedQuestionContent {
    if (!rawText) return { stem: '', options: {} };

    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    
    const stemLines: string[] = [];
    const options: { [key: string]: string } = {};
    let currentKey: string | null = null;
    
    // STATE MACHINE FLAGS
    let isParsingOptions = false; // Starts false until we see Q_TEXT or implicit start
    let hasHitMetadata = false;   // Permanently stops option parsing once true

    // Regex for "A) Text" or "A. Text" or "A: Text" ANCHORED to start of line
    const optionStartRegex = /^\s*([A-E])\s*[:\)\-\.]\s+(.*)/i;
    
    // Regex for metadata headers that definitely end the options block
    const stopRegex = /^\s*(CORRECT|ANSWER|GABARITO|EXPLANATION|COMENTARIO|EXPLANATION_TECH|DISTRACTOR_PROFILE|WRONG_DIAGNOSIS|GUIA_TRAPSCAN|P[0-9]=|Erradas=|Fechamento=)/i;

    // Detect if text starts with explicit Q_TEXT header or just starts
    const hasExplicitHeader = /^\s*(Q_TEXT|QUESTION_TEXT|ENUNCIADO)/i.test(lines[0]);
    if (!hasExplicitHeader) {
        // If no header, assume we start in content mode (stem/options)
        isParsingOptions = true; 
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 1. Check for Stop Signals (Metadata)
        if (stopRegex.test(trimmed)) {
            hasHitMetadata = true;
            isParsingOptions = false;
            // Do not break, we might want to parse other things later, but options are closed.
            continue; 
        }
        
        // 2. Check for explicit Q_TEXT start
        if (/^\s*(Q_TEXT|QUESTION_TEXT|ENUNCIADO)[:=]/i.test(trimmed)) {
            isParsingOptions = true;
            stemLines.push(trimmed.replace(/^\s*(Q_TEXT|QUESTION_TEXT|ENUNCIADO)[:=]\s*/i, ''));
            continue;
        }

        if (hasHitMetadata) continue; // Skip everything after metadata start

        // 3. Option Detection
        const match = trimmed.match(optionStartRegex);
        
        if (match) {
            // Found a new option start
            const key = match[1].toUpperCase();
            const content = match[2].trim();
            
            if (['A','B','C','D','E'].includes(key)) {
                // Sanity check: If content is suspiciously short/meta-like, ignore
                if (content.toLowerCase() === 'correta' || content.toLowerCase() === 'incorreta') {
                    continue; 
                }

                currentKey = key;
                options[key] = content;
                isParsingOptions = true; // Implicitly we are in options now
                continue;
            }
        }

        if (currentKey && isParsingOptions) {
            // Continuation of previous option
            options[currentKey] += '\n' + trimmed;
        } else if (isParsingOptions) {
            // Still in Stem (before first option)
            stemLines.push(trimmed);
        }
    }
    
    // Final Sanitize
    const cleanedOptions: any = {};
    Object.keys(options).forEach(k => {
        const sanitized = sanitizeOptionText(options[k]);
        if (sanitized) {
            cleanedOptions[k] = sanitized;
        }
    });

    return { stem: stemLines.join('\n').trim(), options: cleanedOptions };
}

/**
 * Ensures a Question object has its options parsed and valid.
 * Aggressively repairs corrupted options (like "A: correta").
 */
export function ensureQuestionOptions(q: Question): Question {
    // 1. Check existing options for corruption
    let isCorrupted = false;
    
    if (q.options) {
        const values = Object.values(q.options);
        // Check for specific corruption signatures
        const hasBadValue = values.some(v => {
            if (!v) return false;
            const l = v.toLowerCase().trim();
            return l === 'correta' || l === 'incorreta' || l.includes('erradas=') || l.includes('fechamento=');
        });
        
        if (hasBadValue) {
            isCorrupted = true;
            console.warn(`[QuestionParser] Detected corrupted options in ${q.questionRef}. Triggering re-parse.`);
        }
    }

    // 2. If valid and not corrupted, return sanitized version
    if (!isCorrupted && q.options) {
        let validCount = 0;
        const cleaned: any = {};
        Object.keys(q.options).forEach(k => {
            // @ts-ignore
            const val = q.options[k];
            const cleanVal = sanitizeOptionText(val);
            if (cleanVal) {
                cleaned[k] = cleanVal;
                validCount++;
            }
        });
        
        if (validCount >= 2) {
             return { ...q, options: cleaned };
        }
    }

    // 3. Re-parse from Raw Text (Fallback or Repair)
    // Prefer rawImportBlock if available as it contains the full original context
    const sourceText = q.rawImportBlock || q.questionText;
    const { stem, options } = parseQuestionText(sourceText);
    
    if (Object.keys(options).length >= 2) {
        return {
            ...q,
            // Only update text if we parsed from questionText. 
            // If from rawImportBlock, we might want to keep original questionText if it was fine? 
            // Usually re-parsed stem is safer.
            questionText: stem || q.questionText, 
            options: { ...options } // Replace corrupted options
        };
    }

    return q;
}

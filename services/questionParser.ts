
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
    
    let clean = text;

    // Hardening: Remove explicit "Erradas=A:..." artifacts if they leaked into the option text
    // This happens if the parser didn't split lines correctly previously
    if (clean.includes('Erradas=') || clean.includes('Fechamento=')) {
        return ''; // Mark as invalid/empty so it gets filtered out
    }
    
    // Regex to find Metadata patterns starting with P[0-7]= or specific keywords, 
    // often preceded by a semicolon or whitespace, extending to the end of the string.
    const METADATA_LEAK_REGEX = /(?:^|[;\s]+)(?:P[0-7]\s*[=:]|GUIA_TRAPSCAN|TRAPSCAN_EXIGIDO|WRONG_DIAGNOSIS|Erradas=|Fechamento=)[\s\S]*$/i;
    
    clean = clean.replace(METADATA_LEAK_REGEX, '');
    
    // Remove potential trailing punctuation left behind
    clean = clean.replace(/[;]+$/, '');
    
    return clean.trim();
}

/**
 * Robust parser to extract options from raw text.
 * Rewritten to use Line-Based State Machine for strict boundary detection.
 * Prevents metadata (e.g., EXPLANATION_TECH) from being parsed as options.
 */
export function parseQuestionText(rawText: string): ParsedQuestionContent {
    if (!rawText) return { stem: '', options: {} };

    // Normalize newlines
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    
    const stemLines: string[] = [];
    const options: { [key: string]: string } = {};
    let currentKey: string | null = null;
    let stopParsing = false;

    // Regex for "A) Text" or "A. Text" or "A: Text" ANCHORED to start of line
    const optionStartRegex = /^\s*([A-E])\s*[:\)\-\.]\s+(.*)/i;
    
    // Regex to STOP parsing options if we hit metadata headers or known explanation blocks
    const stopRegex = /^\s*(CORRECT|ANSWER|GABARITO|EXPLANATION|COMENTARIO|EXPLANATION_TECH|DISTRACTOR_PROFILE|WRONG_DIAGNOSIS|GUIA_TRAPSCAN|P[0-9]=|Erradas=|Fechamento=)/i;

    for (const line of lines) {
        // 1. Check for Stop Signals
        if (stopRegex.test(line)) {
            stopParsing = true;
            break; 
        }
        
        if (stopParsing) break;

        const match = line.match(optionStartRegex);
        
        if (match) {
            // Found a new option start
            const key = match[1].toUpperCase();
            const content = match[2].trim();
            
            if (['A','B','C','D','E'].includes(key)) {
                currentKey = key;
                options[key] = content;
                continue;
            }
        }

        if (currentKey) {
            // Continuation of previous option
            if (line.trim()) {
                options[currentKey] += '\n' + line.trim();
            }
        } else {
            // Still in Stem
            stemLines.push(line);
        }
    }
    
    // Final Sanitize & Validate
    const cleanedOptions: any = {};
    let hasValidOptions = false;
    
    Object.keys(options).forEach(k => {
        const val = options[k];
        // Hardening Check: Reject suspicious values
        const lowerVal = val.toLowerCase();
        if (lowerVal === 'correta' || lowerVal === 'incorreta' || lowerVal.includes('fechamento=') || lowerVal.includes('erradas=')) {
            return; 
        }
        
        const sanitized = sanitizeOptionText(val);
        if (sanitized) {
            cleanedOptions[k] = sanitized;
            hasValidOptions = true;
        }
    });

    if (!hasValidOptions) {
        // Fallback: If strict parsing failed, return stem only (don't try loose regex which causes the bug)
        return { stem: rawText, options: {} };
    }

    return { stem: stemLines.join('\n').trim(), options: cleanedOptions };
}

/**
 * Ensures a Question object has its options parsed and valid.
 * Returns a NEW Question object with 'questionText' cleaned (stem only) 
 * and 'options' populated.
 */
export function ensureQuestionOptions(q: Question): Question {
    // 1. Check existing options in object
    let validOptions = false;
    let cleanedExisting: any = {};
    
    if (q.options) {
        Object.keys(q.options).forEach(k => {
            // @ts-ignore
            const val = q.options[k];
            if (val) {
                // Hardening Check
                const lowerVal = val.toLowerCase();
                // Reject suspicious values
                if (lowerVal === 'correta' || lowerVal === 'incorreta' || lowerVal.includes('fechamento=') || lowerVal.includes('erradas=')) {
                    return;
                }
                cleanedExisting[k] = sanitizeOptionText(val);
                validOptions = true;
            }
        });
    }
    
    if (validOptions) {
        return { ...q, options: cleanedExisting };
    }

    // 2. Parse from text if object options are invalid/missing
    const { stem, options } = parseQuestionText(q.questionText);
    
    if (Object.keys(options).length >= 2) {
        return {
            ...q,
            questionText: stem, // Cleaned stem
            options: { ...q.options, ...options } // Merged options
        };
    }

    return q;
}

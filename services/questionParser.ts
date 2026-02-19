
import { Question } from '../types';

export interface ParsedQuestionContent {
    stem: string;
    options: { [key: string]: string | undefined };
}

/**
 * Sanitizes option text to remove Metadata leaks (P1=..., P7=..., GUIA_TRAPSCAN).
 * Returns a clean string for display. Does NOT mutate input.
 */
export function sanitizeOptionText(text: string | undefined): string {
    if (!text) return '';
    
    let clean = text.trim();

    // 1. Remove specific metadata artifacts
    if (/fechamento=/i.test(clean)) {
        clean = clean.split(/fechamento=/i)[0].trim();
    }

    const METADATA_LEAK_REGEX = /(?:^|[;\s]+)(?:P[0-7]\s*[=:]|GUIA_TRAPSCAN|TRAPSCAN_EXIGIDO|WRONG_DIAGNOSIS|Erradas=|Fechamento=)[\s\S]*$/i;
    clean = clean.replace(METADATA_LEAK_REGEX, '');
    
    clean = clean.replace(/[;]+$/, '').trim();

    // 2. Validate resulting text content
    const lower = clean.toLowerCase();
    const invalidKeywords = ['correta', 'incorreta', '—', '-', 'nula', 'undefined', 'null'];
    
    if (clean.length === 0 || invalidKeywords.includes(lower)) {
        return ''; // Mark as invalid/empty
    }

    return clean;
}

/**
 * Extracts options strictly from the raw import block as a fallback.
 * Stops parsing if it hits metadata keywords to avoid false positives.
 */
function extractOptionsFromRaw(rawText: string): { [key: string]: string } {
    if (!rawText) return {};

    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    const recoveredOptions: { [key: string]: string } = {};
    
    // Regex anchored to start of line to avoid capturing "A:" inside sentences
    // Matches "A) Text", "A. Text", "A: Text", "A - Text"
    const optionRegex = /^\s*([A-E])\s*[:\)\-\.]\s+(.+)$/i;
    
    // Stop signals
    const stopRegex = /^\s*(CORRECT|ANSWER|GABARITO|EXPLANATION|COMENTARIO|DISTRACTOR_PROFILE|WRONG_DIAGNOSIS)/i;

    let inMetadataZone = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Stop if we hit metadata
        if (stopRegex.test(trimmed)) {
            inMetadataZone = true;
            continue; 
        }

        // If we are in metadata zone, we stop looking for options to prevent leaks
        // UNLESS the block structure is chaotic, but for safety we stop.
        if (inMetadataZone) continue;

        const match = trimmed.match(optionRegex);
        if (match) {
            const key = match[1].toUpperCase();
            const content = match[2].trim();
            
            // Basic sanity check on content length
            if (content.length > 0 && !content.toLowerCase().startsWith('correta')) {
                 recoveredOptions[key] = sanitizeOptionText(content);
            }
        }
    }
    
    return recoveredOptions;
}

/**
 * Returns a SAFE view of the question.
 * 1. Creates a shallow copy (does NOT mutate original).
 * 2. Checks if options are missing/broken.
 * 3. Attempts to recover missing options from rawImportBlock.
 * 4. Returns the object with the best possible data for display.
 */
export function getSafeQuestionView(question: Question): Question {
    // 1. Shallow clone to prevent mutation of the persistent object
    const safeView = { ...question, options: { ...question.options } };

    // 2. Identify missing keys
    const requiredKeys = ['A', 'B', 'C', 'D', 'E'];
    const missingKeys = requiredKeys.filter(key => {
        const val = safeView.options[key];
        return !val || val.trim() === '' || val === '—';
    });

    // 3. Fallback Recovery Strategy
    if (missingKeys.length > 0 && question.rawImportBlock) {
        const recovered = extractOptionsFromRaw(question.rawImportBlock);
        
        missingKeys.forEach(key => {
            if (recovered[key]) {
                // Apply recovered text only to the view
                safeView.options[key] = recovered[key];
            }
        });
    }

    return safeView;
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
    
    let isParsingOptions = false;
    let hasHitMetadata = false;

    const optionStartRegex = /^\s*([A-E])\s*[:\)\-\.]\s+(.*)/i;
    const stopRegex = /^\s*(CORRECT|ANSWER|GABARITO|EXPLANATION|COMENTARIO|EXPLANATION_TECH|DISTRACTOR_PROFILE|WRONG_DIAGNOSIS|GUIA_TRAPSCAN|P[0-9]=|Erradas=|Fechamento=)/i;

    const hasExplicitHeader = /^\s*(Q_TEXT|QUESTION_TEXT|ENUNCIADO)/i.test(lines[0]);
    if (!hasExplicitHeader) {
        isParsingOptions = true; 
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (stopRegex.test(trimmed)) {
            hasHitMetadata = true;
            isParsingOptions = false;
            continue; 
        }
        
        if (/^\s*(Q_TEXT|QUESTION_TEXT|ENUNCIADO)[:=]/i.test(trimmed)) {
            isParsingOptions = true;
            stemLines.push(trimmed.replace(/^\s*(Q_TEXT|QUESTION_TEXT|ENUNCIADO)[:=]\s*/i, ''));
            continue;
        }

        if (hasHitMetadata) continue;

        const match = trimmed.match(optionStartRegex);
        
        if (match) {
            const key = match[1].toUpperCase();
            const content = match[2].trim();
            
            if (['A','B','C','D','E'].includes(key)) {
                if (content.toLowerCase() === 'correta' || content.toLowerCase() === 'incorreta') {
                    continue; 
                }
                currentKey = key;
                options[key] = content;
                isParsingOptions = true;
                continue;
            }
        }

        if (currentKey && isParsingOptions) {
            options[currentKey] += '\n' + trimmed;
        } else if (isParsingOptions) {
            stemLines.push(trimmed);
        }
    }
    
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
 * IMPORTANT: This function modifies the object for storage purposes. 
 * For display purposes without mutation, use getSafeQuestionView.
 */
export function ensureQuestionOptions(q: Question): Question {
    // 1. Check existing options for corruption
    let isCorrupted = false;
    
    if (q.options) {
        const values = Object.values(q.options);
        const hasBadValue = values.some(v => {
            if (!v) return false;
            const l = v.toLowerCase().trim();
            return l === 'correta' || l === 'incorreta' || l.includes('erradas=') || l.includes('fechamento=');
        });
        
        if (hasBadValue) {
            isCorrupted = true;
        }
    }

    // 2. If valid and not corrupted, return sanitized version
    if (!isCorrupted && q.options) {
        const cleaned: any = {};
        let hasChanges = false;
        
        Object.keys(q.options).forEach(k => {
            // @ts-ignore
            const val = q.options[k];
            const cleanVal = sanitizeOptionText(val);
            if (val !== cleanVal) hasChanges = true;
            if (cleanVal) {
                cleaned[k] = cleanVal;
            }
        });
        
        if (hasChanges) {
             return { ...q, options: cleaned };
        }
    }

    // 3. Re-parse from Raw Text (Fallback or Repair)
    const sourceText = q.rawImportBlock || q.questionText;
    const { stem, options } = parseQuestionText(sourceText);
    
    if (Object.keys(options).length >= 2) {
        return {
            ...q,
            questionText: stem || q.questionText, 
            options: { ...options } 
        };
    }

    return q;
}

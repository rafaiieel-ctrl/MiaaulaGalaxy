
import * as srs from './srsService';

/**
 * Normalizes a Law Code/ID.
 */
export function normalizeLawCode(code: string): string {
    if (!code) return 'GERAL';
    return code.trim().toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9_]/g, "_")
        .replace(/_+/g, "_");
}

/**
 * CANONICAL DOC_KEY GENERATOR
 * Format: LAW_ID::LIT_REF
 * This ensures that if we re-import the same article, we generate the exact same ID.
 */
export function generateDocKey(lawId: string, litRef: string): string {
    const code = normalizeLawCode(lawId);
    const ref = srs.canonicalizeLitRef(litRef);
    return `${code}::${ref}`;
}

/**
 * CANONICAL QUESTION KEY GENERATOR
 * Format: Q_REF (Normalized)
 * Questions are unique by their Reference Code within the system.
 */
export function generateQuestionKey(qRef: string): string {
    return srs.canonicalizeLitRef(qRef);
}

/**
 * ID DETERMINÍSTICO (Legacy wrapper or Fallback)
 * Formato: LIT_REF::TYPE::IDX
 */
export function makeDeterministicId(litRef: string, type: string, idx: number | string): string {
    const canon = srs.canonicalizeLitRef(litRef);
    const idxStr = String(idx).padStart(2, '0');
    return `${canon}::${type.toUpperCase()}::${idxStr}`;
}

/**
 * ID ESTÁVEL (Alias para Determinístico)
 */
export function makeStableId(litRef: string, type: string, idx: number | string): string {
    return makeDeterministicId(litRef, type, idx);
}

export function makeProgressPk(userId: string, itemId: string): string {
    return `${userId}:${itemId}`;
}

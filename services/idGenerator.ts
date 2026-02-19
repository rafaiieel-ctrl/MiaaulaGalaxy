
import * as srs from './srsService';

/**
 * Normalizes a Law Code to a standard format (Upper, Underscores).
 * Ex: "RICMS-MT" -> "RICMS_MT"
 */
export function normalizeLawCode(code: string): string {
    if (!code) return 'GERAL';
    return code.trim().toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9]/g, "_")
        .replace(/_+/g, "_");
}

/**
 * Normalizes Article numbering.
 * Ex: "Art. 5º" -> "5"
 * Ex: "Artigo 123-A" -> "123_A"
 */
export function normalizeArticle(art: string): string {
    if (!art) return '0';
    let clean = art.trim().toUpperCase()
        .replace(/^ART\.?\s*/, '')
        .replace(/^ARTIGO\s*/, '')
        .replace('º', '')
        .replace('°', '')
        .replace('ª', '');
    
    clean = clean.replace(/[^A-Z0-9]/g, "_");
    return clean;
}

/**
 * Normalizes Paragraphs/Incisos structure for the key.
 * This can be expanded for granular imports (Par/Inc/Alin).
 * For now, we focus on the Article ID.
 */
export function normalizeDocType(type: string): string {
    return type ? type.trim().toUpperCase() : 'ART';
}

/**
 * CANONICAL DOC_KEY GENERATOR
 * Structure: LAW_CODE::DOC_TYPE::ART_NUM
 * Ex: CTN::ART::141
 */
export function generateDocKey(lawCode: string, article: string, docType: string = 'ART'): string {
    const code = normalizeLawCode(lawCode);
    const type = normalizeDocType(docType);
    const art = normalizeArticle(article);
    
    return `${code}::${type}::${art}`;
}

/**
 * CANONICAL QUESTION KEY GENERATOR
 * Structure: DOC_KEY::Q_REF
 * Uses the parent's ID to ensure strict linkage.
 */
export function generateQuestionKey(parentDocKey: string, qRef: string): string {
    const cleanRef = srs.canonicalizeLitRef(qRef);
    return `${parentDocKey}::${cleanRef}`;
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

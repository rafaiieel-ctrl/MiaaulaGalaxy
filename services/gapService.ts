
export interface GapPart {
    type: 'text' | 'gap';
    content: string;
}

export interface ParsedGap {
    displayText: string; // Texto corrido com máscara simples (_____)
    answers: string[]; // Lista de respostas extraídas
    parts: GapPart[]; // Array estruturado para renderização rica
}

// Helper para normalizar texto para comparação (ignora case e acentos)
export const normalizeGapValue = (val: string): string => {
    if (!val) return '';
    return val.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Faz o parsing de templates de lacunas no formato {{conteúdo}}.
 * Suporta acentos, maiúsculas/minúsculas e múltiplos tokens com espaços.
 */
export const parseGapTemplate = (rawText: string): ParsedGap => {
    if (!rawText) return { displayText: '', answers: [], parts: [] };

    // Regex atualizada para suportar qualquer caractere exceto '}' (lazy match)
    // Permite {{Acentuação}}, {{ Espaços }}, {{123}}
    const regex = /\{\{\s*([^}]+?)\s*\}\}/g;
    
    const answers: string[] = [];
    const parts: GapPart[] = [];
    let lastIndex = 0;
    let match;

    // Loop de extração
    while ((match = regex.exec(rawText)) !== null) {
        // 1. Texto antes da lacuna
        if (match.index > lastIndex) {
            parts.push({
                type: 'text',
                content: rawText.substring(lastIndex, match.index)
            });
        }

        // 2. Conteúdo da lacuna (gabarito)
        let content = match[1].trim();
        
        // Validação básica para ignorar placeholders vazios ou quebrados
        if (!content) content = "?";

        answers.push(content);
        parts.push({
            type: 'gap',
            content: content
        });

        lastIndex = regex.lastIndex;
    }

    // 3. Texto restante após a última lacuna
    if (lastIndex < rawText.length) {
        parts.push({
            type: 'text',
            content: rawText.substring(lastIndex)
        });
    }

    // Fallback/Warning se não encontrar tokens
    if (answers.length === 0) {
        return {
            displayText: rawText,
            answers: [],
            parts: [{ type: 'text', content: rawText }]
        };
    }

    // Gera string simples para displays que não suportam componentes ricos
    const displayText = rawText.replace(regex, '_____');

    return { displayText, answers, parts };
};

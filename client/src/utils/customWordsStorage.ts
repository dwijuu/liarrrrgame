// 커스텀 단어 브라우저 영구 저장 유틸리티
const STORAGE_KEY = 'liarGameCustomWords';

/**
 * 저장된 커스텀 단어 목록 불러오기
 */
export function getSavedCustomWords(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(w => (typeof w === 'string' ? w.trim() : ''))
        .filter(w => w.length > 0);
    }
  } catch (e) {
    console.error('Failed to load custom words from localStorage:', e);
  }
  return [];
}

/**
 * 커스텀 단어 목록 전체 저장
 */
export function saveCustomWords(words: string[]): string[] {
  try {
    const sanitized = words
      .map(w => (typeof w === 'string' ? w.trim() : ''))
      .filter(w => w.length > 0);
    const unique = Array.from(new Set(sanitized));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
    return unique;
  } catch (e) {
    console.error('Failed to save custom words to localStorage:', e);
    return words;
  }
}

/**
 * 단어 1개 추가
 */
export function addCustomWord(word: string): string[] {
  const trimmed = word.trim();
  if (!trimmed) return getSavedCustomWords();
  const current = getSavedCustomWords();
  if (!current.includes(trimmed)) {
    current.push(trimmed);
    return saveCustomWords(current);
  }
  return current;
}

/**
 * 단어 1개 삭제
 */
export function deleteCustomWord(word: string): string[] {
  const current = getSavedCustomWords();
  const filtered = current.filter(w => w !== word.trim());
  return saveCustomWords(filtered);
}

/**
 * 단어 수정
 */
export function editCustomWord(oldWord: string, newWord: string): string[] {
  const trimmedNew = newWord.trim();
  if (!trimmedNew) return getSavedCustomWords();
  const current = getSavedCustomWords();
  const updated = current.map(w => (w === oldWord ? trimmedNew : w));
  return saveCustomWords(updated);
}

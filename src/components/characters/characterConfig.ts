import saDefault from '../../assets/characters/sa/sa-default.svg';
import iDefault from '../../assets/characters/i/i-default.svg';
import coupleDefault from '../../assets/characters/couple/couple-default.svg';
import coupleLove from '../../assets/characters/couple/couple-love.svg';
import coupleMiss from '../../assets/characters/couple/couple-miss.svg';
import coupleHug from '../../assets/characters/couple/couple-hug.svg';
import coupleCheer from '../../assets/characters/couple/couple-cheer.svg';
import coupleAnniversary from '../../assets/characters/couple/couple-anniversary.svg';
import coupleMemory from '../../assets/characters/couple/couple-memory.svg';

export type CharacterMood = 'default' | 'love' | 'miss' | 'happy' | 'sad' | 'sorry' | 'thanks' | 'hug' | 'cheer' | 'sleep' | 'anniversary' | 'memory';
export type CharacterKind = 'sa' | 'i' | 'couple';

export const characterAssets: Record<CharacterKind, Partial<Record<CharacterMood, string>>> = {
  sa: { default: saDefault },
  i: { default: iDefault },
  couple: { default: coupleDefault, love: coupleLove, miss: coupleMiss, hug: coupleHug, cheer: coupleCheer, anniversary: coupleAnniversary, memory: coupleMemory },
};

export const signalCharacters = { miss: 'miss', love: 'love', hug: 'hug', cheer: 'cheer' } as const satisfies Record<string, CharacterMood>;

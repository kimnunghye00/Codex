import { characterAssets, type CharacterKind, type CharacterMood } from './characterConfig';

export function Character({ kind = 'couple', mood = 'default', size = 'medium', className = '' }: { kind?: CharacterKind; mood?: CharacterMood; size?: 'avatar' | 'small' | 'medium' | 'hero'; className?: string }) {
  const src = characterAssets[kind][mood] ?? characterAssets[kind].default;
  const label = kind === 'sa' ? '수달 캐릭터 사' : kind === 'i' ? '수달 캐릭터 이' : '함께 있는 수달 캐릭터 사와 이';
  return <img className={`character character-${size} ${className}`} src={src} alt={label} />;
}

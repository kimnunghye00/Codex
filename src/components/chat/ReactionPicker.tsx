const EMOJIS = ['❤️', '👍', '🥰', '😂', '😢'];

export function ReactionPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return <div className="reaction-picker" role="menu" aria-label="이모지 반응">{EMOJIS.map((emoji) => <button type="button" key={emoji} onClick={() => onSelect(emoji)}>{emoji}</button>)}</div>;
}

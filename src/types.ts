export type Sender = 'me' | 'partner';

export type Reaction = { emoji: string; by: Sender };

export type Message = {
  id: number;
  sender: Sender;
  type: 'text' | 'image' | 'gallery' | 'gif' | 'sticker';
  text?: string;
  imageUrl?: string;
  imageUrls?: string[];
  stickerId?: string;
  timestamp: string;
  read: boolean;
  replyTo?: number;
  reactions?: Reaction[];
  saved?: boolean;
  scheduledFor?: string;
};

export type Memory = {
  id: number;
  title: string;
  date: string;
  description: string;
  images: string[];
  videos?: string[];
  location?: string;
  tags?: string[];
  createdBy: Sender;
  ownerUid?: string;
  favorite?: boolean;
};

export type MemoryDraft = Pick<Memory, 'title' | 'date' | 'description'> & Partial<Pick<Memory, 'location' | 'tags'>>;

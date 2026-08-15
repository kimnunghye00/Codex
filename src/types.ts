export type Sender = 'me' | 'partner';

export type Reaction = { emoji: string; by: Sender };

export type Message = {
  id: number;
  sender: Sender;
  type: 'text' | 'image';
  text?: string;
  imageUrl?: string;
  timestamp: string;
  read: boolean;
  replyTo?: number;
  reactions?: Reaction[];
  saved?: boolean;
};

export type Memory = {
  id: number;
  title: string;
  date: string;
  description: string;
  images: string[];
  location?: string;
  tags?: string[];
  createdBy: Sender;
  favorite?: boolean;
};

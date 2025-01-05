export interface Song {
  id: string;
  title: string;
  artist: string;
  genre: string;
  tags: string[];
  bpm?: number;
  keySignature?: string;
  timeSignature?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [string: string]: any;
}

export interface Genre {
  id: string;
  name: string;
  songs: Song[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [string: string]: any;
}

export interface Connection {
  id: string;
  sourceSongId: string;
  targetSongId: string;
  tags: string[];
}

export interface SetList {
  id: string;
  name: string;
  songs: Song[];
  connections: Connection[];
}

export type MusicConnectionHandler = (connection: Connection) => void;

export type EdgeConnection = {
  connection: Connection;
  handleEditConnection: MusicConnectionHandler;
};

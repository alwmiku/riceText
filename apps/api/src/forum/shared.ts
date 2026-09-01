import type { ForumUser } from "@ricetext/contracts";

export interface UserRow {
  id: string;
  name: string;
  role: "author" | "reader" | "moderator";
  is_friend: number;
  bio: string;
}

export function mapUser(row: UserRow): ForumUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    isFriend: row.is_friend === 1,
    bio: row.bio,
  };
}

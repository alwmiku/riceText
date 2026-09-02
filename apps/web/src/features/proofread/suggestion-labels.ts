const SUGGESTION_AUTHOR_LABELS: Readonly<Record<string, string>> = {
  reader: "读者",
  user_reader: "读者",
  author: "作者",
  user_author: "作者",
  moderator: "版主",
  user_moderator: "版主",
};

/** 将建议中的内部身份值转换为面向用户的中文标签。 */
export function formatSuggestionAuthor(authorId: string): string {
  return SUGGESTION_AUTHOR_LABELS[authorId] ?? authorId;
}

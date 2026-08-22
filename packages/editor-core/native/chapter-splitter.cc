// C++ Addon 示例：长文本按章切分。
//
// 构建后产物期望输出到：
//   packages/editor-core/native/chapter-splitter.node
//
// 本文件只是接口骨架，实际生产环境建议使用 node-addon-api 并做完整 Unicode/正则处理。

#include <node_api.h>
#include <string>
#include <vector>

namespace {

struct Chapter {
  std::string title;
  std::string text;
  size_t start = 0;
  size_t end = 0;
};

// 示例实现：按“第...章”简单切分。
// 生产环境应替换为完整的 C++ 正则/状态机实现。
std::vector<Chapter> SplitChapters(const std::string& text) {
  std::vector<Chapter> chapters;
  size_t pos = 0;
  while (pos < text.size()) {
    size_t line_end = text.find('\n', pos);
    if (line_end == std::string::npos) line_end = text.size();
    std::string line = text.substr(pos, line_end - pos);
    if (line.rfind("第", 0) == 0 && line.find("章") != std::string::npos) {
      Chapter chapter;
      chapter.title = line;
      chapter.start = pos;
      chapter.end = text.size();
      if (!chapters.empty()) chapters.back().end = pos;
      chapters.push_back(chapter);
    }
    pos = line_end + 1;
  }
  if (chapters.empty() && !text.empty()) {
    Chapter chapter;
    chapter.title = "未命名章节";
    chapter.start = 0;
    chapter.end = text.size();
    chapter.text = text;
    chapters.push_back(chapter);
  } else {
    for (size_t i = 0; i < chapters.size(); ++i) {
      size_t start = chapters[i].start + chapters[i].title.size();
      size_t end = chapters[i].end;
      chapters[i].text = text.substr(start, end - start);
    }
  }
  return chapters;
}

napi_value Split(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  size_t text_length = 0;
  napi_get_value_string_utf8(env, args[0], nullptr, 0, &text_length);
  std::string text(text_length, '\0');
  napi_get_value_string_utf8(env, args[0], &text[0], text_length + 1, &text_length);

  auto chapters = SplitChapters(text);

  napi_value result;
  napi_create_array_with_length(env, chapters.size(), &result);
  for (size_t i = 0; i < chapters.size(); ++i) {
    napi_value item;
    napi_create_object(env, &item);

    napi_value title;
    napi_create_string_utf8(env, chapters[i].title.c_str(), chapters[i].title.size(), &title);
    napi_set_named_property(env, item, "title", title);

    napi_value body;
    napi_create_string_utf8(env, chapters[i].text.c_str(), chapters[i].text.size(), &body);
    napi_set_named_property(env, item, "text", body);

    napi_value start;
    napi_create_double(env, static_cast<double>(chapters[i].start), &start);
    napi_set_named_property(env, item, "start", start);

    napi_value end;
    napi_create_double(env, static_cast<double>(chapters[i].end), &end);
    napi_set_named_property(env, item, "end", end);

    napi_set_element(env, result, i, item);
  }

  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "split", NAPI_AUTO_LENGTH, Split, nullptr, &fn);
  napi_set_named_property(env, exports, "split", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

}  // namespace

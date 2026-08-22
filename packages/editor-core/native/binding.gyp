{
  "targets": [
    {
      "target_name": "chapter-splitter",
      "sources": ["chapter-splitter.cc"],
      "conditions": [
        ["OS=='win'", {
          "defines": ["NAPI_DLL"]
        }]
      ]
    }
  ]
}

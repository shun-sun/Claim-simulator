node.jsの設定
npm install groq-sdk express cors dotenv

GeminiAPIから変更する場合
# 1. Geminiを削除
npm uninstall @google/generative-ai

# 2. Groqとその他の必須ツールをインストール
npm install groq-sdk express cors dotenv

起動方法
.envにgroqのAPIキーを格納
ターミナルで実行
node server.js

HTMLフォルダ内のStart.htmlを開く

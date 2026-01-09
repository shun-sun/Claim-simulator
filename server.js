require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const cors = require('cors');

const app = express();
const PORT = 3000;

// APIキーのチェック
if (!process.env.GROQ_API_KEY) {
    console.error('エラー: GROQ_API_KEY が .env ファイルに設定されていません。');
    process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// モデル: Llama 3.3 70B (非常に賢く、Gemini 1.5 Flashより高性能な場合が多い)
const MODEL_NAME = "llama-3.3-70b-versatile"; 

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('バックエンドサーバーへようこそ！Groq APIの準備ができました。');
});

app.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました。 http://localhost:${PORT}/ でアクセスできます。`);
});

// --- 共通のリクエスト処理 ---
async function callGroq(messages, jsonMode = false) {
    const params = {
        messages: messages,
        model: MODEL_NAME,
        temperature: 0.7,
        max_tokens: 1024,
    };
    
    // JSONモードの指定
    if (jsonMode) {
        params.response_format = { type: "json_object" };
    }

    try {
        const completion = await groq.chat.completions.create(params);
        return completion.choices[0]?.message?.content || "";
    } catch (error) {
        console.error("Groq API Error:", error);
        throw error;
    }
}

// ---------------------------------------------
// 1. クレーム生成 API
// ---------------------------------------------
app.post('/api/initiate-claim', async (req, res) => {
  try {
    const { difficulty } = req.body;
    if (!difficulty || !['easy', 'normal', 'crazy'].includes(difficulty)) {
      return res.status(400).json({ error: "有効な難易度を指定してください。" });
    }

    const claimGenres = [
        "コンビニでアルバイト中の商品の取り扱い", "カフェでのオーダーミス", "ファミレスでの料理の提供時間",
        "書店での本の在庫切れ", "ドラッグストアでの商品の場所案内", "スーパーでの割引商品の対応", 
        "ファストフード店での注文間違い","スーパーでの食品の品質問題",
    ];
    const randomGenre = claimGenres[Math.floor(Math.random() * claimGenres.length)];

    let promptContent;
    const baseJsonInstruction = `出力は必ずJSON形式のみにしてください。Markdownのコードブロックや余計な会話文は含めないでください。`;

    switch (difficulty) {
      case 'easy':
        promptContent = `あなたはお客様です。「${randomGenre}」に関して少し困っている状況です。
          アルバイト店員に対して、穏やかだが少し困っている様子で問題を伝えてください。
          ${baseJsonInstruction}
          形式:
          {
            "claim": "（ここに、丁寧だが少し困っている様子のクレーム文を1～2文で記述）",
            "summary": "（ここに、そのクレーム内容を15文字以内で要約したものを記述）"
          }`;
        break;
      case 'crazy':
        promptContent = `あなたは非常に短気で、自分の意見を曲げないお客様です。「${randomGenre}」について、
          アルバイト店員に対して強い口調で不満を主張してください。
          ${baseJsonInstruction}
          形式:
          {
            "claim": "（ここに、高圧的で一方的なクレーム文を1～2文で記述）",
            "summary": "（ここに、そのクレーム内容を15文字以内で要約したものを記述）"
          }`;
        break;
      case 'normal':
      default:
        promptContent = `あなたは論理的に物事を考えるお客様です。「${randomGenre}」について、
          アルバイト店員に対して筋道立てて具体的な不満点を指摘してください。
          感情的にならず、冷静に問題点を伝えてください。
          ${baseJsonInstruction}
          形式:
          {
            "claim": "（ここに、論理的で冷静なクレーム文を1～2文で記述）",
            "summary": "（ここに、そのクレーム内容を15文字以内で要約したものを記述）"
          }`;
        break;
    }
    
    const responseText = await callGroq([{ role: "user", content: promptContent }], true);
    let responseObject;
    
    try {
      responseObject = JSON.parse(responseText);
    } catch (parseError) {
      console.error("JSON解析エラー:", parseError, "Response:", responseText);
      return res.status(500).json({ error: "AIの応答形式が不正です。" });
    }

    res.json({ claim: responseObject.claim, summary: responseObject.summary });

  } catch (error) {
    console.error("Groq API (initiate-claim) エラー:", error);
    res.status(500).json({ error: "AIによるクレーム生成に失敗しました。" });
  }
});

// ---------------------------------------------
// 2. 応答生成 (チャット) API
// ---------------------------------------------
app.post('/api/handle-response', async (req, res) => {
  const { conversationHistory, playerMessage, difficulty } = req.body;

  if (!conversationHistory || typeof playerMessage === 'undefined' || !difficulty) {
    return res.status(400).json({ error: "不足しているデータがあります。" });
  }

  try {
    // Gemini形式の履歴をOpenAI互換(Groq)形式に変換
    const groqHistory = conversationHistory.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.parts[0].text
    }));

    // オウム返しチェックなどは省略（必要なら同様に追加可能）

    let systemInstructionText;
    const commonRules = `【最重要ルール】あなたは商品の無料提供や割引、金銭的な賠償を一切要求しません。ただし、プレイヤーからの「返品」や「交換」の提案は受け入れます。`;
    const afterDamageRule = `【ダメージ後のルール】直前のあなたの返答に[DAMAGE]が含まれていた場合、プレイヤーの次の発言が「なんでですか」のような単純な質問や短い相槌であっても、決して[CLEAR]にしてはいけません。必ず会話を続けるようにしてください。`;

    switch (difficulty) {
      case 'easy':
        systemInstructionText = `# 役割設定
あなたは穏やかで物分かりの良い顧客です。少し困っていますが、丁寧な対応で満足します。
${commonRules}
${afterDamageRule}
# 判定基準
## クリア条件（[CLEAR]を付ける）
- プレイヤーが「謝罪の言葉」と「解決策」の両方を提示した場合
- 例：「分かりました。それで大丈夫です。 [CLEAR]」
## ダメージ条件（[DAMAGE]を付ける）
- プレイヤーが明らかに不適切な言葉を使った場合のみ
## 通常の会話（何も付けない）
- 上記以外の場合は通常の顧客として対応
# 絶対命令
- 無言や応答拒否は絶対禁止`;
        break;
      case 'crazy':
        systemInstructionText = `# 役割設定
あなたは「自分が絶対に正しい」と信じて疑わない、非常に高圧的な顧客です。
${commonRules}
${afterDamageRule}
# 判定基準
## クリア条件（[CLEAR]を付ける）
- あなたの勢いが弱まった後、心のこもった謝罪・原因説明・解決策の3点が出た場合
## ダメージ条件（[DAMAGE]を付ける）
- 上記以外。暴言には「その口の利き方はなんだ！ [DAMAGE]」と返す
# 絶対命令
- 応答拒否は絶対禁止`;
        break;
      case 'normal':
      default:
        systemInstructionText = `# 役割設定
あなたは論理的で常識的な顧客です。
${commonRules}
${afterDamageRule}
# 判定基準
## クリア条件（[CLEAR]を付ける）
- 謝罪と具体的解決策の2点が出た場合
## ダメージ条件（[DAMAGE]を付ける）
- 不適切な態度や不足がある場合
# 絶対命令
- 応答拒否は絶対禁止`;
        break;
    }

    const messages = [
        { role: "system", content: systemInstructionText },
        ...groqHistory,
        { role: "user", content: playerMessage }
    ];

    const aiResponseText = await callGroq(messages, false);

    res.json({ response: aiResponseText });

  } catch (error) {
    console.error("Groq API (handle-response) エラー:", error);
    res.status(500).json({ error: "AIによる応答生成に失敗しました。" });
  }
});

// ---------------------------------------------
// 3. ヒント生成 API
// ---------------------------------------------
app.post('/api/get-hint', async (req, res) => {
    const { conversationHistory, complaint } = req.body;
  
    if (!conversationHistory || !complaint) {
      return res.status(400).json({ error: "不足データあり" });
    }
  
    try {
        const hintPrompt = `# クレーム対応ゲーム - 具体的ヒント生成
クレーム：「${complaint}」
履歴：${JSON.stringify(conversationHistory)}
役割：プレイヤーが今すぐ実行すべき具体的な行動を提案。
出力形式：JSONのみ {"hints": ["ヒント1", "ヒント2", "ヒント3"]}`;
        
        const responseText = await callGroq([{ role: "user", content: hintPrompt }], true);
        const responseObject = JSON.parse(responseText);
  
        res.json({ hints: responseObject.hints });
  
    } catch (error) {
        console.error("Groq API (get-hint) エラー:", error);
        res.status(500).json({ error: "ヒント生成失敗" });
    }
});
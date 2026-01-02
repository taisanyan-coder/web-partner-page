import { useCallback, useEffect, useMemo, 
  useState } from 'react';
import {
  defaultOptions,
  formatRoundForDiscord,
  generateAllRounds,
  ocrToCandidates,
  parseInput,
  validatePlayers,
  type Player,
  type RoundData,
  type Summary,
} from './lib/logic';

const rankOptions = ['S', 'A', 'B', 'C', 'D'] as const;

const sampleInput = `すみか, A
レイン, B
みなと, S
ゆい, C
りん, B
たくみ, A
さくら, B
あおい, C
たける, B
まな, A
あき, C
ひなた, D`;

function App() {
  const [participantsText, setParticipantsText] = useState(sampleInput);
  const [roundCount, setRoundCount] = useState(5);
  const [candidateCount, setCandidateCount] = useState(20);
  const [defaultRank, setDefaultRank] = useState('B');
  const [ocrCandidates, setOcrCandidates] = useState('');
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [roundsData, setRoundsData] = useState<RoundData[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastPlayers, setLastPlayers] = useState<Player[] | null>(null);
 const [justFinished, setJustFinished] = useState(false);

 

  // ★UX改善：生成中フラグ
  const [isGenerating, setIsGenerating] = useState(false);

  const options = useMemo(
    () => ({
      ...defaultOptions,
      candidateCount,
    }),
    [candidateCount],
  );

  const runGenerate = useCallback(
    (players: Player[]) => {
      const { roundsData: nextRounds, summary: nextSummary } = generateAllRounds(
        players,
        roundCount,
        options,
      );
      setRoundsData(nextRounds);
      setSummary(nextSummary);
    },
    [options, roundCount],
  );

  // ★生成：押した感を出す（0.8秒だけ生成中を表示）
const handleGenerate = useCallback(() => {
  if (isGenerating) return;

  setIsGenerating(true);
  setJustFinished(false);

  const players = parseInput(participantsText);
  const validation = validatePlayers(players);

  if (!validation.ok) {
    setErrors(validation.errors);
    setRoundsData([]);
    setSummary(null);
    setIsGenerating(false);
    return;
  }

  setErrors([]);
  setLastPlayers(players);
  runGenerate(players);

  // ① 生成中…を0.8秒表示
  setTimeout(() => {
  setIsGenerating(false);
  setJustFinished(true);

  // 1秒後に「生成完了」を消す
  setTimeout(() => {
    setJustFinished(false);
  }, 1000);
}, 800);

}, [participantsText, runGenerate]);


  const handleRegenerate = useCallback(() => {
    if (!lastPlayers) {
      setErrors(['まず「生成」を実行してください']);
      return;
    }
    setErrors([]);
    runGenerate(lastPlayers);
  }, [lastPlayers, runGenerate]);

  const handleClear = useCallback(() => {
    setParticipantsText('');
    setRoundsData([]);
    setSummary(null);
    setErrors([]);
    setLastPlayers(null);
  }, []);

  const handleOcr = useCallback(async (file: File) => {
    setOcrProgress(0);
    try {
      const candidates = await ocrToCandidates(file, setOcrProgress);
      setOcrCandidates(candidates.join('\n'));
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      setErrors([`OCRに失敗しました: ${message}`]);
    } finally {
      setOcrProgress(null);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) {
        void handleOcr(file);
      }
    },
    [handleOcr],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            void handleOcr(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleOcr]);

  const handleApplyCandidates = useCallback(() => {
    const lines = ocrCandidates
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `${line}, ${defaultRank}`);
    setParticipantsText(lines.join('\n'));
  }, [ocrCandidates, defaultRank]);

  return (
    <div className="app">
  
  <header>
    <h1>
      チームシャッフル生成ツール
      <span
        style={{
          display: 'block',
          fontSize: '0.45em',
          marginTop: 4,
          color: '#666',
          fontWeight: 500,
          letterSpacing: '0.08em',
        }}
      >
        （crafted by 🐾 nyanco）
      </span>
    </h1>

    <p>
      参加者を4人チームに分け、実力バランス・重複回避・リーダー偏りを抑えながら
      ラウンドを生成します。
    </p>
  </header>


      <section className="panel">
        <h2>1) 入力エリア</h2>
        <label>
          参加者入力（1行=1人 / name, rank）
          <textarea
            value={participantsText}
            onChange={(event) => setParticipantsText(event.target.value)}
            rows={10}
            placeholder="すみか, A"
          />
        </label>

        <div className="grid">
          <label>
            ラウンド数（1〜10）
            <input
              type="number"
              min={1}
              max={10}
              value={roundCount}
              onChange={(event) => setRoundCount(Number(event.target.value))}
            />
          </label>

          <label>
            生成回数（10〜200）
            <input
              type="number"
              min={10}
              max={200}
              value={candidateCount}
              onChange={(event) => setCandidateCount(Number(event.target.value))}
            />
          </label>

          <label>
            OCR反映時のデフォルトrank
            <select value={defaultRank} onChange={(event) => setDefaultRank(event.target.value)}>
              {rankOptions.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          </label>
        </div>

         

        <div className="button-row">
          <button onClick={handleGenerate} disabled={isGenerating}>
  {isGenerating ? '生成中…' : justFinished ? '生成完了！' : '生成'}
</button>


          <button onClick={handleRegenerate} className="secondary">
            もう一回生成
          </button>

          <button onClick={handleClear} className="ghost">
            クリア
          </button>
        </div>

        {errors.length > 0 && (
          <div className="error">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>2) 画像から抽出（OCR）</h2>
        <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <p>画像をドラッグ＆ドロップ / クリップボード貼り付け / ファイル選択</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleOcr(file);
              }
            }}
          />
        </div>

        {ocrProgress !== null && <p className="progress">OCR解析中... {ocrProgress}%</p>}

        <label>
          参加者名候補（編集可）
          <textarea
            value={ocrCandidates}
            onChange={(event) => setOcrCandidates(event.target.value)}
            rows={6}
            placeholder="OCR候補がここに表示されます"
          />
        </label>

        <button onClick={handleApplyCandidates} className="secondary">
          候補を参加者欄に反映
        </button>
      </section>

      <section className="panel">
        <h2>3) 結果表示</h2>
        {roundsData.length === 0 ? (
          <p>まだラウンドが生成されていません。</p>
        ) : (
          <div className="rounds">
            {roundsData.map((roundData) => (
              <div key={roundData.round} className="round">
                <header className="round-header">
                  <h3>Round {roundData.round}</h3>
                  <button onClick={() => void navigator.clipboard.writeText(roundData.discordText)}>
                    このラウンドをコピー
                  </button>
                </header>

                <div className="teams">
                  {roundData.teams.map((team, teamIndex) => {
                    const diff = team.sum - roundData.metrics.averageSum;
                    const diffText = diff === 0 ? '±0' : diff > 0 ? `+${diff}` : `${diff}`;
                    return (
                      <div key={teamIndex} className="team">
                        <h4>
                          Party {teamIndex + 1}{' '}
                          <span className="muted">(sum={team.sum}, diff={diffText})</span>
                        </h4>
                        <ul>
                          {team.members.map((member, index) => (
                            <li key={member.id}>
                              {index === 0 ? <strong>(L)</strong> : null} {member.name} ({member.rank})
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                {/* マッチアップ表示は完全削除（必要ならこのコメントを外して復活） */}
                {/*
                <div className="matchups">
                  <h4>対戦ペア</h4>
                  <ul>
                    {roundData.matchups.map((pair, index) => {
                      const first = roundData.teams.indexOf(pair[0]) + 1;
                      const second = roundData.teams.indexOf(pair[1]) + 1;
                      return (
                        <li key={index}>
                          Party {first} vs Party {second}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                */}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>全体サマリ</h2>
        {summary ? (
          <div className="summary">
            <p>重複ペア数（合計）: {summary.pairDuplicateTotal}</p>
            <p>最多ペア重複回数: {summary.maxPairCount}</p>
            <p>同一4人チームの完全重複: {summary.duplicateTeams}</p>
            {summary.duplicateTeams > 0 && (
              <p className="warning">同一4人組が再出現しています。</p>
            )}
            <div>
              <h4>リーダー偏り統計</h4>
              <ul>
                {Object.entries(summary.leaderCounts).map(([name, count]) => (
                  <li key={name}>
                    {name}: {count}回
                  </li>
                ))}
              </ul>
              <p>
                最大リーダー回数: {summary.maxLeaderCount} / 最小: {summary.minLeaderCount}
              </p>
              {summary.leaderWarning && (
                <p className="warning">リーダー回数の偏りが大きい可能性があります。</p>
              )}
            </div>
          </div>
        ) : (
          <p>ラウンド生成後にサマリが表示されます。</p>
        )}
      </section>

      {roundsData.length > 0 && (
        <section className="panel">
          <h2>Discordコピー用テキスト</h2>
          <textarea
            value={roundsData.map((round) => formatRoundForDiscord(round)).join('\n\n')}
            readOnly
            rows={12}
          />
        </section>
      )}
    </div>
  );
}

export default App;

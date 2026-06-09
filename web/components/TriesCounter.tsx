/**
 * 다중검정 카운터 — triesIndex 를 크게. "100개 돌리면 5개는 운으로 좋다".
 * 시도가 많을수록 게이트 기준을 더 엄격히 봐야 한다(validation.md 3번).
 */
interface Props {
  triesIndex: number;
}

export function TriesCounter({ triesIndex }: Props) {
  // 다중검정 하 우연한 합격 기대치: tries * 0.05 (α=0.05 가정, 거친 직관).
  const luckyExpected = Math.max(0, triesIndex) * 0.05;
  const severe = triesIndex >= 20;

  return (
    <div>
      <div className="metric" style={{ borderColor: severe ? "#eab308" : undefined }}>
        <div className="label">다중검정 — 이 전략 시도 횟수</div>
        <div className="value big" data-testid="tries-index">
          #{triesIndex}
        </div>
        <div className="hint">
          지금까지 {triesIndex}개 조합을 시도. 우연히 좋아 보일 기대 개수 ≈{" "}
          {luckyExpected.toFixed(1)}개 (α=0.05).
        </div>
      </div>
      <div className={`banner ${severe ? "danger" : "warn"}`} style={{ marginTop: 12 }}>
        ⚠ <strong>과최적화 자각:</strong> 100개를 돌리면 약 5개는 순전히 운으로
        게이트를 통과한다. 시도가 많을수록(현재 #{triesIndex}) 게이트 기준을 더
        엄격히 적용하고, in-sample 우수성만으로 결론짓지 말 것.
      </div>
    </div>
  );
}

import '../styles/components.css';

const STATUS_COLORS = {
  active: 'var(--color-gold)',
  in_progress: 'var(--color-gold)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
  available: 'var(--color-accent)'
};

const STATUS_LABELS = {
  active: '⚔️ Active',
  in_progress: '⚔️ In Progress',
  completed: '✅ Completed',
  failed: '💀 Failed',
  available: '📋 Available'
};

export default function QuestCard({ quest }) {
  const statusColor = STATUS_COLORS[quest.status] || 'var(--color-muted)';
  const statusLabel = STATUS_LABELS[quest.status] || quest.status;

  return (
    <div className="quest-card">
      <div className="quest-card-header">
        <h3 className="quest-card-name">{quest.name}</h3>
        <span className="quest-card-status" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>
      <p className="quest-card-description">{quest.description}</p>
      <div className="quest-card-meta">
        {quest.given_by && (
          <span className="quest-card-npc">
            Given by: <strong>{quest.given_by}</strong>
          </span>
        )}
        {quest.location && (
          <span className="quest-card-location">
            📍 {quest.location}
          </span>
        )}
      </div>
      {quest.current_stage && (
        <div className="quest-card-progress">
          <span className="quest-card-stage">
            Stage: {quest.current_stage.replace(/_/g, ' ')}
          </span>
          {quest.stages_completed && quest.stages_completed.length > 0 && (
            <div className="quest-card-stages-done">
              {quest.stages_completed.map((s, i) => (
                <span key={i} className="stage-pip completed" title={s.replace(/_/g, ' ')} />
              ))}
              <span className="stage-pip current" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

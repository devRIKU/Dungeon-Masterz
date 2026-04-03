import React from 'react';
import { ChevronRight, Send, Sparkles } from 'lucide-react';
import { StoryChoice } from '../types';

type OptionDeckProps = {
  choices: StoryChoice[];
  customActionInput: string;
  onCustomActionChange: (value: string) => void;
  onChoice: (choice: StoryChoice) => void;
  onSubmitCustomAction: () => void;
  disabled?: boolean;
};

export default function OptionDeck({
  choices,
  customActionInput,
  onCustomActionChange,
  onChoice,
  onSubmitCustomAction,
  disabled = false,
}: OptionDeckProps) {
  return (
    <section className="panel option-deck">
      <div className="option-deck-heading">
        <div>
          <p className="eyebrow">Choose Your Move</p>
          <h3 className="panel-title">Immersive choices, one scene at a time</h3>
        </div>
        <div className="option-deck-sigil">
          <Sparkles className="h-4 w-4" />
        </div>
      </div>

      <div className="option-grid">
        {choices.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            disabled={disabled}
            onClick={() => onChoice(choice)}
            className="option-card"
          >
            <span className="option-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="option-copy">{choice.text}</span>
            <ChevronRight className="option-arrow h-4 w-4" />
          </button>
        ))}
      </div>

      <div className="custom-action-shell">
        <label className="eyebrow" htmlFor="custom-action-input">Or write your own action</label>
        <div className="custom-action-row">
          <textarea
            id="custom-action-input"
            value={customActionInput}
            disabled={disabled}
            onChange={(event) => onCustomActionChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && customActionInput.trim()) {
                onSubmitCustomAction();
              }
            }}
            className="custom-action-input"
            placeholder="Whisper a risky plan, invoke an omen, or try something nobody offered..."
          />
          <button
            type="button"
            disabled={disabled || !customActionInput.trim()}
            onClick={onSubmitCustomAction}
            className="submit-action-button"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

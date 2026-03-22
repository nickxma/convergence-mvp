'use client';

import { useState } from 'react';

/**
 * DisplayNameEditor — lets Acceptance Pass holders set a display name.
 * Name is stored off-chain; this component calls /api/profile/display-name
 * (POST) when the API is ready. For now it manages local state only.
 */

interface DisplayNameEditorProps {
  wallet: string;
  currentName: string | null;
  hasPass: boolean;
  isOwner: boolean;
  onSave: (name: string) => void;
}

export function DisplayNameEditor({
  wallet: _wallet,
  currentName,
  hasPass,
  isOwner,
  onSave,
}: DisplayNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOwner) return null;
  if (!hasPass) {
    return (
      <p className="text-xs mt-1" style={{ color: '#9c9080' }}>
        Acceptance Pass holders can set a display name.
      </p>
    );
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (trimmed.length > 32) {
      setError('Display name must be 32 characters or fewer.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // TODO: replace with real API call when available
      // await fetch('/api/profile/display-name', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ wallet: _wallet, name: trimmed }),
      // });
      await new Promise((r) => setTimeout(r, 400)); // simulate latency
      onSave(trimmed);
      setEditing(false);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs underline underline-offset-2 transition-opacity hover:opacity-70"
        style={{ color: '#7d8c6e' }}
      >
        {currentName ? 'Edit display name' : 'Set a display name'}
      </button>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="Your display name"
          maxLength={32}
          autoFocus
          className="text-sm px-3 py-1.5 rounded-lg border outline-none flex-1 min-w-0"
          style={{
            background: '#faf8f3',
            borderColor: '#b8ccb0',
            color: '#2c2c2c',
          }}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-opacity disabled:opacity-50"
          style={{ background: '#7d8c6e', color: '#fff' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => { setEditing(false); setValue(currentName ?? ''); setError(null); }}
          className="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
          style={{ color: '#9c9080' }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-xs mt-1" style={{ color: '#c0392b' }}>
          {error}
        </p>
      )}
      <p className="text-xs mt-1" style={{ color: '#b0a898' }}>
        {value.length}/32
      </p>
    </div>
  );
}

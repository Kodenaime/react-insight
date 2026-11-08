import { useState, useEffect } from 'react';

function CounterButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button onClick={onClick}>{label}</button>;
}

export function App() {
  const [count, setCount] = useState(0);
  const [text, setText] = useState('');

  useEffect(() => {
    document.title = `React Insight — ${count}`;
  }, [count]);

  return (
    <div className="app">
      <h1>React Insight — Example</h1>
      <p>Count: {count}</p>
      <CounterButton label="Increment" onClick={() => setCount(c => c + 1)} />
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type to trigger re-renders"
      />
      <p>Text: {text}</p>
    </div>
  );
}

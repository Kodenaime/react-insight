import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
function CounterButton({ onClick, label }) {
    return _jsx("button", { onClick: onClick, children: label });
}
export function App() {
    const [count, setCount] = useState(0);
    const [text, setText] = useState('');
    useEffect(() => {
        document.title = `React Insight — ${count}`;
    }, [count]);
    return (_jsxs("div", { className: "app", children: [_jsx("h1", { children: "React Insight \u2014 Example" }), _jsxs("p", { children: ["Count: ", count] }), _jsx(CounterButton, { label: "Increment", onClick: () => setCount(c => c + 1) }), _jsx("input", { value: text, onChange: e => setText(e.target.value), placeholder: "Type to trigger re-renders" }), _jsxs("p", { children: ["Text: ", text] })] }));
}

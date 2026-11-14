import React, { useRef, useState } from 'react';
import Deliverable from '../work/Deliverable';
import { chatChoices } from '../../../shared/chatChoices';
import { useLang } from '../../lib/i18n';
export default function ChoiceReply({ body, onChoose }: { body: string; onChoose?: (text: string) => Promise<void> }) {
 const choices = chatChoices(body);
 const { lang } = useLang();
 const [selected, setSelected] = useState<string | null>(null);
 const [error, setError] = useState(false);
 const locked = useRef(false);
 if (!choices || !onChoose) return <Deliverable content={body} />;
 return <div><Deliverable content={choices.before} /><div className="km-choice-list" role="group" aria-label={lang === 'pt' ? 'Escolha uma resposta' : 'Choose an answer'}>
 {choices.options.map(option => <button key={option.letter} disabled={selected !== null} aria-pressed={selected === option.letter} onClick={async () => {
   if (locked.current) return;
   locked.current = true; setSelected(option.letter); setError(false);
   try { await onChoose(`${option.letter}) ${option.label}`); }
   catch { locked.current = false; setSelected(null); setError(true); }
 }}><span aria-hidden="true">{option.letter}</span>{option.label}</button>)}
 </div><p className="km-choice-hint">{lang === 'pt' ? 'Ou escreva sua resposta no campo abaixo.' : 'Or write your answer in the field below.'}</p>{error && <p role="alert">{lang === 'pt' ? 'Não foi possível enviar. Tente novamente ou escreva sua resposta.' : 'Could not send. Try again or type your answer.'}</p>}<Deliverable content={choices.after} /></div>;
}

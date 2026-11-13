import React from 'react';
import { Select, Text } from '@mantine/core';
import { useLang, type Lang } from '../../lib/i18n';
export default function LanguagePicker() {
  const { lang, setLang, languageError } = useLang();
  return <div className="km-language-picker"><Select aria-label={lang === 'pt' ? 'Idioma da interface' : 'Interface language'} size="xs" w={140} allowDeselect={false} data={[{value:'pt',label:'Português (Brasil)'},{value:'en',label:'English'}]} value={lang} onChange={v => { if (v) setLang(v as Lang); }} />{languageError && <Text role="alert" size="xs">{languageError}</Text>}</div>;
}

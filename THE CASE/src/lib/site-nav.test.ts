import { describe, it, expect } from 'vitest';
import { buildInfoLinks } from './site-nav';

describe('buildInfoLinks (авто-навигация из страниц Контента)', () => {
  it('каждая опубликованная страница становится кликабельной ссылкой /{slug}', () => {
    const links = buildInfoLinks([
      { slug: 'about', title: 'О компании' },
      { slug: 'faq', title: 'Вопросы и ответы' },
      { slug: 'delivery', title: 'Доставка и оплата' },
    ]);
    expect(links).toEqual([
      { href: '/about', label: 'О компании' },
      { href: '/faq', label: 'Вопросы и ответы' },
      { href: '/delivery', label: 'Доставка и оплата' },
    ]);
  });

  it('отбрасывает пустые slug/title и служебный slug contacts (есть отдельная ссылка)', () => {
    const links = buildInfoLinks([
      { slug: '', title: 'пусто' },
      { slug: 'x', title: '' },
      { slug: 'contacts', title: 'Контакты' },
      { slug: 'terms', title: 'Соглашение' },
    ]);
    expect(links).toEqual([{ href: '/terms', label: 'Соглашение' }]);
  });

  it('пустой список страниц → пустые ссылки (навигация деградирует на дефолт)', () => {
    expect(buildInfoLinks([])).toEqual([]);
  });
});

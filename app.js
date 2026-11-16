'use strict';

(() => {
  const {
    slots, preparations, servings, groups, units, appearances, recipeTags, nutrientEntries, blankMacros, clone, emptyWeek, empty, samples,
    recipeCategories, recipeCategory, componentRoles, mealName, mealTotals, mealRecipes, draftPick, mealSnapshot,
    date, shift, today, workWeek, plannedEntries, totals, frequency, suggest, chosenRecipe,
    shoppingPlan, shopping, addStock, prepare, undoPreparation, validate, normalize,
    ingredientKey, baseUnit, amount, roundQuantity
  } = Model;

  const $ = selector => document.querySelector(selector);
  const app = $('#app');
  const modal = $('#modal');
  const status = $('#status');
  const systemAppearance = window.matchMedia?.('(prefers-color-scheme: dark)');
  const sections = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'week', label: 'Settimana', icon: 'calendar' },
    { id: 'recipes', label: 'Ricette', icon: 'book' },
    { id: 'shop', label: 'Spesa', icon: 'basket' }
  ];
  const examples = samples();
  const samplePhotos = [
    'media/esempio-0.jpg', 'media/esempio-1.jpg', 'media/esempio-2.jpg',
    'media/esempio-3.jpg', 'media/esempio-4.jpg', 'media/esempio-5.jpg'
  ];
  const limit = 1e12;
  const dayFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
  const dayOffsets = [...new Set(slots.map(slot => slot.offset))];
  const longFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const formatNumber = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
  const formatQuantity = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 6 });
  const htmlChars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => htmlChars[char]);
  const number = value => formatNumber.format(value);
  const quantity = (qty, unit) => `${formatQuantity.format(qty)} ${unit}`;
  const id = () => globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const recipeUnit = key => key === 'kcal' ? 'kcal' : 'g';

  let state = empty();
  let storage;
  let storedRaw = null;
  let damaged = false;
  let saving = false;
  let screen = 'home';
  let weekKey = workWeek();
  let homeDay = defaultDay(weekKey);
  let query = '';
  let category = '';
  let tag = '';
  let archivedOnly = false;
  let statusTimer;
  let modalSubmit;
  let submitting = false;

  const week = () => state.weeks[weekKey] || emptyWeek();
  const recipeById = recipeId => state.recipes.find(recipe => recipe.id === recipeId);
  const activeRecipes = () => state.recipes.filter(recipe => !recipe.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const slotDate = slot => shift(weekKey, slot.offset);
  const hasPlan = record => Object.keys(record.plan).length > 0;
  const shoppingItems = (record, data = state) => shopping(shoppingPlan(data, record), data.pantry);
  const currentAppearance = () => state.appearance ?? 'system';

  function applyAppearance() {
    const preference = currentAppearance();
    const theme = preference === 'system' ? (systemAppearance?.matches ? 'dark' : 'light') : preference;
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    root.dataset.theme = theme;
    const themeColor = $('meta[name="theme-color"]');
    if (themeColor) themeColor.content = getComputedStyle(root).getPropertyValue('--canvas').trim();
  }

  function defaultDay(key) {
    const current = today();
    return dayOffsets.find(offset => shift(key, offset) === current) ?? dayOffsets[0];
  }

  function toast(message, error = false) {
    clearTimeout(statusTimer);
    status.textContent = message;
    if (!error) statusTimer = setTimeout(() => { status.textContent = ''; }, 4300);
  }

  async function commit(change, { replace = false } = {}) {
    if (saving) throw new Error('Attendi la fine del salvataggio.');
    if (!storage) throw new Error('L’archivio locale non è disponibile.');
    if (damaged && !replace) throw new Error('Ripristina un backup per sbloccare il salvataggio.');
    saving = true;
    try {
      const next = change(clone(state), weekKey);
      const raw = JSON.stringify(validate(next));
      await storage.write(raw, storedRaw);
      storedRaw = raw;
      state = next;
      damaged = false;
    } finally {
      saving = false;
    }
  }

  function changeWeek(update) {
    return commit((next, key) => {
      const record = next.weeks[key] ??= emptyWeek();
      update(record, next, key);
      clearChangedChecks(record, next);
      return next;
    });
  }

  function navigate(target, key = weekKey) {
    screen = target;
    if (key !== weekKey) homeDay = defaultDay(key);
    weekKey = key;
    render();
    window.scrollTo(0, 0);
    app.querySelector('h1')?.focus({ preventScroll: true });
  }

  function range(key) {
    const start = date(key);
    const end = date(shift(key, slots.at(-1).offset));
    const from = start.getMonth() === end.getMonth() ? start.getDate() : dayFormat.format(start);
    return `${from}–${longFormat.format(end)}`;
  }

  const button = (label, action, value = '', style = '') =>
    `<button type="button" class="${style}" data-action="${action}" data-value="${escape(value)}">${escape(label)}</button>`;
  const title = name => `<div class="page-title"><h1 tabindex="-1">${escape(name)}</h1></div>`;
  const emptyCard = (heading, text, action = '') =>
    `<div class="card empty"><h3>${escape(heading)}</h3><p class="muted">${escape(text)}</p>${action ? `<div class="actions">${action}</div>` : ''}</div>`;
  const option = (value, name, current) =>
    `<option value="${escape(value)}"${value === current ? ' selected' : ''}>${escape(name)}</option>`;

  function weekPicker() {
    return `<div class="week" aria-label="Intervallo dei pasti">
      <button type="button" class="quiet arrow" data-action="week-step" data-value="-7" aria-label="Settimana precedente">‹</button>
      <div class="week-date"><strong>${range(weekKey)}</strong>${weekKey === workWeek() ? '' : button('Torna alla settimana di riferimento', 'week-today', '', 'text-button')}</div>
      <button type="button" class="quiet arrow" data-action="week-step" data-value="7" aria-label="Settimana successiva">›</button>
    </div>`;
  }

  function macroTiles(summary) {
    return `<dl class="stats">${nutrientEntries.map(([key, label]) => {
      const { value, partial } = summary[key];
      const text = value === null ? '—' : `${number(value)} <span>${recipeUnit(key)}</span>`;
      return `<div><dt>${label}</dt><dd>${text}</dd>${partial && value !== null ? '<small>parziale</small>' : ''}</div>`;
    }).join('')}</dl>`;
  }

  function homeNutrients(record) {
    const plan = Object.fromEntries(preparations.map(({ cook }) => [cook, chosenRecipe(state, record, cook)]));
    const entries = plannedEntries({ plan }, homeDay);
    if (!entries.length) return '<p class="muted nutrition-note">Scegli i piatti del giorno per vedere la stima.</p>';
    const meals = entries.map(entry => entry.meal.toLocaleLowerCase('it')).join(' e ');
    return `<p class="muted nutrition-note">Stima per ${meals}${record.draft ? ' · Bozza' : ''}</p>${macroTiles(totals(entries))}`;
  }

  function homePage() {
    const record = week();
    const grocery = shoppingItems(record);
    const missing = grocery.filter(item => item.needed > 0);
    const pending = missing.filter(item => record.checked[item.key] !== item.needed).length;
    const upcoming = preparations.find(slot => slotDate(slot) >= today() && record.plan[slot.cook] && !record.prepared?.[slot.cook]);
    const caption = upcoming ? `${upcoming.label} · ${dayFormat.format(date(slotDate(upcoming)))}` : 'Da lunedì cena a giovedì pranzo';
    const heroTitle = upcoming ? mealName(record.plan[upcoming.cook]) :
      hasPlan(record) ? 'Il tuo piano' : 'Organizza i pasti fuori sede';
    const heroText = upcoming ? 'Una porzione a cena, l’altra a pranzo.' : 'Tre preparazioni, sei pasti.';
    const dayButtons = dayOffsets.map(offset => {
      const { day } = slots.find(slot => slot.offset === offset);
      const calendarDate = date(shift(weekKey, offset));
      return `<button type="button" class="quiet" data-action="pick-day" data-value="${offset}"
        aria-label="${day} ${dayFormat.format(calendarDate)}" aria-pressed="${offset === homeDay}">${day.slice(0, 3)} ${calendarDate.getDate()}</button>`;
    }).join('');
    return `${title('Home')}${weekPicker()}
      <div class="home-grid"><section class="hero">
        <div class="hero-content"><p class="hero-caption">${escape(caption)}</p><h2>${escape(heroTitle)}</h2>
        <p class="hero-note">${heroText}</p>${button(hasPlan(record) ? 'Apri la settimana' : 'Pianifica i pasti', 'nav', 'week')}</div>
        <div class="hero-pattern" aria-hidden="true"><span></span></div>
      </section>
        <section class="card nutrition">
          <h2>Nutrienti del giorno</h2>
          <div class="day-picker" role="group" aria-label="Giorno dei nutrienti">${dayButtons}</div>
          <div id="home-nutrients" aria-live="polite" aria-atomic="true">${homeNutrients(record)}</div>
        </section>
        <section class="card grocery-summary">
          <div>
          <h2>Lista della spesa</h2>
          ${grocery.length || hasPlan(record) ? `<p class="grocery-pending"><strong class="grocery-count">${pending}</strong> ${pending === 1 ? 'voce da spuntare' : 'voci da spuntare'}</p>` :
            '<p class="muted">La lista si genera con il piano.</p>'}
          </div>
          <div class="actions">${button('Apri la spesa', 'nav', 'shop', 'quiet')}</div>
        </section>
      </div>
      <div class="home-utilities">${button('Impostazioni', 'settings', '', 'text-button')}${button('Backup', 'backup', '', 'text-button')}</div>`;
  }

  function startDraft(record) {
    return {
      picks: Object.fromEntries(Object.entries(record.plan).map(([cook, meal]) => [cook, draftPick(meal)])),
      locked: Object.keys(record.prepared || {})
    };
  }

  function mealEditor(prep, record, meal, list) {
    const { cook } = prep;
    const draft = record.draft;
    const pick = draft.picks[cook] || '';
    const saved = record.plan[cook];
    const selectOptions = (items, selected, prior, placeholder) => {
      const matching = items.some(item => item.id === selected);
      const fallback = selected && !matching ?
        option(selected, prior?.id === selected ? prior.name + ' · dal piano' : 'Voce non disponibile', selected) : '';
      return option('', placeholder, selected) + items.map(item => option(item.id, item.name, selected)).join('') + fallback;
    };
    return `<div class="prep-editor">
      <label>Tipo di piatto<select data-change="meal-type" data-value="${cook}">
        ${option('', 'Piatto completo', pick.components ? 'componibile' : '')}
        ${option('componibile', 'Piatto componibile', pick.components ? 'componibile' : '')}</select></label>
      ${pick.components ? `<div class="stack component-choices">${componentRoles.map(({ value, label }) =>
        `<label>${label}<select data-change="component" data-value="${cook}" data-role="${value}">
          ${selectOptions(list.filter(item => item.componentRole === value), pick.components[value] || '', saved?.components?.[value], 'Nessuno')}
        </select></label>`).join('')}</div>` :
        `<label>Ricetta<select data-change="pick" data-value="${cook}">
          ${selectOptions(list.filter(item => !item.componentRole), pick, saved, 'Scegli una ricetta')}</select></label>`}
      <label class="check lock"><input type="checkbox" data-change="lock" data-value="${cook}"
        ${meal && draft.locked.includes(cook) ? 'checked' : ''} ${meal ? '' : 'disabled'}><span>Mantieni per ${prep.label.toLocaleLowerCase('it')}</span></label>
    </div>`;
  }

  function weekPage() {
    const record = week();
    const draft = record.draft;
    const confirmed = hasPlan(record);
    const list = activeRecipes();
    const canLoadExamples = examples.length && !examples.some(recipe => recipeById(recipe.id));
    const recipeActions = button('Nuova ricetta', 'edit-recipe') +
      (canLoadExamples ? button('Carica esempi', 'load-samples', '', 'quiet') : '');
    const canConfirm = draft && preparations.every(({ cook }) => chosenRecipe(state, record, cook));
    const actions = draft ? `
      <button type="button" class="quiet" data-action="suggest"${list.length ? '' : ' disabled'}>Suggerisci rotazione</button>
      <button type="button" data-action="confirm-plan"${canConfirm ? '' : ' disabled'}>Conferma settimana</button>
      ${button('Vai alla spesa', 'nav', 'shop', 'quiet')}
      ${button('Scarta bozza', 'discard-draft', '', 'text-button')}` :
      confirmed ? button('Modifica piano', 'edit-plan', '', 'quiet') + button('Vai alla spesa', 'nav', 'shop') :
        `<button type="button" class="quiet" data-action="edit-plan"${list.length ? '' : ' disabled'}>Scegli i piatti</button>
        <button type="button" data-action="suggest"${list.length ? '' : ' disabled'}>Suggerisci rotazione</button>`;

    const cards = preparations.map(prep => {
      const { cook } = prep;
      const done = Boolean(record.prepared?.[cook]);
      const lunch = slots.find(slot => slot.cook === cook && !slot.prepares);
      const meal = chosenRecipe(state, record, cook);
      return `<article class="card prep">
        <div class="prep-heading"><span class="date-chip"><small>${prep.day}</small><strong>${date(slotDate(prep)).getDate()}</strong></span>
        <div><h3>${prep.label}</h3>${lunch ? `<p class="muted compact">Seconda porzione · ${lunch.label.toLocaleLowerCase('it')}</p>` : ''}</div></div>
        ${draft && !done ? mealEditor(prep, record, meal, list) :
          `<p class="prep-recipe">${escape(mealName(meal) || 'Da scegliere')}</p>`}
        ${meal ? `<div class="prep-meta"><small>${servings(cook)} porzioni · ${meal.components ? 'Piatto componibile' : escape(recipeCategory(meal))}</small>
          ${button('Scheda', 'planned-recipe', cook, 'text-button')}</div>` : ''}
        ${done ? `<div class="actions"><span class="tag">Preparata</span>
          ${draft ? '' : button('Annulla preparazione', 'review-undo', cook, 'text-button')}</div>` :
          !draft && meal ? `<div class="actions">${button('Segna preparata', 'review-prepare', cook, 'quiet')}
            ${meal.components ? button('Modifica composizione', 'edit-plan', cook, 'text-button') : ''}</div>` : ''}
      </article>`;
    }).join('');

    return `${title('Settimana')}
      ${weekPicker()}<div class="section-title"><h2>Tre preparazioni</h2><span class="tag">${draft ? 'Bozza' : confirmed ? 'Piano confermato' : 'Da pianificare'}</span></div>
      ${!list.length ? emptyCard('Aggiungi o riattiva una ricetta', 'Per scegliere i piatti, usa le ricette attive.',
        recipeActions + (state.recipes.length ? button('Vai alle ricette', 'nav', 'recipes', 'quiet') : '')) : ''}
      <div class="stack ${!list.length ? 'space' : ''}">${cards}</div>
      <div class="actions plan-actions">${actions}</div>
      ${draft ? '<p class="muted compact">Le ricette che scegli entrano subito nella lista della spesa.</p>' : ''}`;
  }

  function recipesPage() {
    const missingExamples = state.recipes.some(recipe => recipe.sample) && examples.some(recipe => !recipeById(recipe.id));
    return `${title('Ricette')}
      ${state.recipes.length ? `<div class="fields filters">
        <label class="recipe-search">Cerca<input id="recipe-search" type="search" placeholder="Piatto o ingrediente" value="${escape(query)}"></label>
        <label>Categoria<select data-change="category">${option('', 'Tutte le categorie', category)}
          ${recipeCategories.map(name => option(name, name, category)).join('')}</select></label>
        <label>Tag<select data-change="tag">${option('', 'Tutti i tag', tag)}
          ${recipeTags.map(({ value, label }) => option(value, label, tag)).join('')}</select></label>
      </div>` : ''}
      <div class="section-title archive-actions">${button('＋ Nuova ricetta', 'edit-recipe')}
        ${state.recipes.length ? `<label class="check archive-check"><input type="checkbox" data-change="archive-filter" ${archivedOnly ? 'checked' : ''}><span>Archiviate</span></label>` : ''}</div>
      <div id="recipe-results" class="recipe-grid">${recipeResults()}</div>
      ${missingExamples ? `<div class="actions space">${button('Carica altri esempi', 'load-samples', '', 'quiet')}</div>` : ''}`;
  }

  function recipeResults() {
    if (!state.recipes.length) return examples.length ?
      emptyCard('Il ricettario è vuoto', 'Aggiungi un tuo piatto oppure prova la rotazione con piatti e componenti di esempio.',
        button('Carica esempi', 'load-samples', '', 'quiet')) :
      emptyCard('Il ricettario è vuoto', 'Aggiungi la tua prima ricetta.');
    const needle = normalize(query);
    const counts = frequency(state);
    const results = state.recipes.filter(recipe => recipe.archived === archivedOnly &&
      (!category || recipeCategory(recipe) === category) && (!tag || recipe.tags?.includes(tag)) &&
      normalize([recipe.name, ...recipe.ingredients.map(item => item.name)].join(' ')).includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    if (!results.length) return emptyCard('Nessuna ricetta', 'Prova a cambiare ricerca o filtri.');
    return results.map(recipe => {
      const planned = counts.get(recipe.id)?.planned || 0;
      const badges = recipeBadges(recipe);
      return `<button type="button" class="card recipe-card" data-action="recipe" data-value="${escape(recipe.id)}">
        <span class="recipe-cover">${recipeImage(recipe, 'loading="lazy"')}</span>
        <span class="recipe-info">
          <small class="recipe-category">${escape(recipeCategory(recipe))}${recipe.sample ? ' · Esempio' : ''}</small>
          <strong>${escape(recipe.name)}</strong>
          <span class="recipe-meta">
            ${recipe.componentRole ? `<small>${componentLabel(recipe.componentRole)}</small>` : ''}
            ${badges ? `<span class="recipe-tags">${badges}</span>` : ''}
            ${recipe.macros.kcal === null ? '' : `<span class="recipe-cal">${number(recipe.macros.kcal)} kcal<small> a porzione</small></span>`}
            ${planned ? `<small>${planned} ${planned === 1 ? 'volta' : 'volte'} nel piano · 30 gg</small>` : ''}
          </span>
        </span>
      </button>`;
    }).join('');
  }

  const componentLabel = role => componentRoles.find(({ value }) => role === value)?.label || '';

  function recipeBadges(recipe) {
    return recipeTags.filter(({ value }) => recipe.tags?.includes(value))
      .map(({ label }) => `<span class="tag">${label}</span>`).join('');
  }

  function recipeImage(recipe, attributes = '') {
    const sample = examples.length && recipe.sample && /^esempio-[0-5]$/.test(recipe.id) ? samplePhotos[Number(recipe.id.at(-1))] : '';
    const src = recipe.photo || sample;
    return src ? `<img src="${escape(src)}" alt="" ${attributes}>` : '';
  }

  function shopPage() {
    const record = week();
    const list = shoppingItems(record);
    const buy = list.filter(item => item.needed);
    const covered = list.filter(item => !item.needed);
    const checked = buy.filter(item => record.checked[item.key] === item.needed).length;
    const pantry = Object.entries(state.pantry).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'it'));
    function pantryRow(key, name, value, unit) {
      return `<div class="shop-row"><span><strong>${escape(name)}</strong><small>${quantity(value, unit)}</small></span>
        ${button('Modifica', 'pantry-edit', key, 'quiet')}</div>`;
    }
    const byGroup = groups.map(group => {
      const items = buy.filter(item => item.group === group);
      if (!items.length) return '';
      return `<section class="card department"><h3>${group}</h3>${items.map(item =>
        `<div class="shop-row"><label class="check"><input type="checkbox" data-change="shop-check" data-value="${escape(item.key)}"
          ${record.checked[item.key] === item.needed ? 'checked' : ''}>
          <span><strong>${escape(item.name)} · ${quantity(item.needed, item.unit)} da comprare</strong>
          <small>Servono ${quantity(item.qty, item.unit)} · In dispensa ${quantity(item.available, item.unit)}</small></span></label>
          <button type="button" class="quiet" aria-label="Dispensa per ${escape(item.name)}" data-action="pantry-edit" data-value="${escape(item.key)}">Dispensa</button></div>`).join('')}</section>`;
    }).join('');
    const listContent = byGroup || (covered.length ? emptyCard('Hai già tutto', 'La dispensa copre le preparazioni rimanenti.') :
      hasPlan(record) && !record.draft ? emptyCard('Preparazioni completate', 'La lista si aggiorna con le ricette ancora da preparare.') :
        emptyCard('Scegli una ricetta', 'Appena scegli un piatto, qui trovi gli ingredienti.', button('Vai a Settimana', 'nav', 'week', 'quiet')));
    return `${title('Spesa')}${weekPicker()}
      <div class="section-title"><h2>Da comprare</h2>${buy.length ? `<span class="tag" id="shopping-progress">${checked} / ${buy.length} spuntate</span>` : ''}</div>
      <div class="stack">${listContent}</div>
      ${buy.length ? `<div class="actions space"><button id="stock-purchases" type="button" class="quiet" data-action="stock-purchases"${checked ? '' : ' disabled'}>Metti gli acquisti in dispensa</button></div>` : ''}
      ${covered.length ? `<details class="card section"><summary>Già disponibili · ${covered.length}</summary>
        ${covered.map(item => `<div class="shop-row"><span><strong>${escape(item.name)}</strong>
          <small>Servono ${quantity(item.qty, item.unit)} · In dispensa ${quantity(item.available, item.unit)}</small></span>
          ${button('Modifica', 'pantry-edit', item.key, 'quiet')}</div>`).join('')}</details>` : ''}
      <section class="section"><div class="section-title"><h2>Dispensa</h2>${button('＋ Aggiungi', 'pantry-edit', '', 'quiet')}</div>
        ${pantry.length ? `<div class="card department">${pantry.map(([key, item]) => pantryRow(key, item.name, item.qty, item.unit)).join('')}</div>` :
          '<p class="muted">Inserisci le quantità che hai a disposizione. Puoi partire anche da una voce della lista.</p>'}
      </section>`;
  }

  const pages = { home: homePage, week: weekPage, recipes: recipesPage, shop: shopPage };

  function render() {
    applyAppearance();
    $('#tabs').innerHTML = sections.map(({ id, label, icon }) =>
      `<button type="button" data-action="nav" data-value="${id}"${screen === id ? ' aria-current="page"' : ''}>
        <span class="tab-icon icon-${icon}" aria-hidden="true"></span>${label}</button>`).join('');
    const alert = damaged ? '<p class="notice">L’archivio salvato non è leggibile. Apri Backup per ripristinare una copia.</p>' :
      storage?.mode === 'temporary' ? '<p class="notice">Archivio temporaneo. Esporta un backup prima di chiudere.</p>' : '';
    app.innerHTML = alert + pages[screen]();
    app.dataset.screen = screen;
  }

  function showModal(label, content, onSubmit) {
    $('#modal-title').textContent = label;
    $('#modal-content').innerHTML = content;
    modalSubmit = onSubmit;
    if (!modal.open) modal.showModal();
    modal.scrollTop = 0;
  }

  function settingsModal() {
    showModal('Impostazioni', `<div class="stack">
      <h3 id="appearance-label">Aspetto</h3>
      <div class="appearance-options" role="group" aria-labelledby="appearance-label">
        ${appearances.map(({ value, label }) => `<button type="button" class="quiet" data-action="appearance"
          data-value="${value}" aria-pressed="${currentAppearance() === value}">${label}</button>`).join('')}
      </div>
      <p class="muted compact">Automatico segue l’aspetto del dispositivo.</p>
      <p class="form-error" role="alert"></p>
    </div>`);
  }

  const form = (body, submit = 'Salva', extras = '') =>
    `<form class="stack">${body}<p class="form-error" role="alert"></p><div class="actions">${extras}<button type="submit">${submit}</button></div></form>`;
  const numeric = (name, label, value = '', { min = 0, max = limit, step = 'any', required = false, placeholder = '' } = {}) =>
    `<label>${label}<input type="number" name="${name}" min="${min}" max="${max}" step="${step}"
      inputmode="${step === 1 ? 'numeric' : 'decimal'}" value="${escape(value)}" ${required ? 'required' : ''} placeholder="${escape(placeholder)}"></label>`;
  const field = (name, label, value = '', { required = false, placeholder = '', readOnly = false } = {}) =>
    `<label>${label}<input name="${name}" value="${escape(value)}" placeholder="${escape(placeholder)}"
      ${required ? 'required' : ''} ${readOnly ? 'readonly' : ''} maxlength="140"></label>`;
  const notes = (label, value) =>
    `<label>${label}<textarea name="notes" maxlength="3000">${escape(value)}</textarea></label>`;
  const readText = (data, name) => String(data.get(name) || '').trim();
  const readNumber = (data, name) => Number(data.get(name));
  const macroFields = macros => `<div class="fields">${nutrientEntries.map(([key, label]) =>
    numeric(key, `${label} (${recipeUnit(key)})`, macros[key], { placeholder: '—' })).join('')}</div>`;
  const readMacros = data => Object.fromEntries(nutrientEntries.map(([key]) =>
    [key, data.get(key) === '' ? null : readNumber(data, key)]));

  function ingredientRow(item = {}) {
    return `<fieldset class="ingredient"><legend>Ingrediente</legend>
      ${field('ingredient-name', 'Nome', item.name, { required: true, placeholder: 'Es. riso' })}
      ${numeric('ingredient-qty', 'Quantità', item.qty, { min: .000001, required: true })}
      <label>Unità<select name="ingredient-unit">${units.map(unit => option(unit, unit, item.unit || 'g')).join('')}</select></label>
      <label>Reparto<select name="ingredient-group">${groups.map(group => option(group, group, item.group || 'Dispensa')).join('')}</select></label>
      ${button('Rimuovi', 'remove-ingredient', '', 'text-button')}</fieldset>`;
  }

  function recipeDetail(recipe, snapshot = false) {
    const items = recipe.ingredients.map(item =>
      `<li><strong>${escape(item.name)}</strong> <span>${quantity(item.qty, item.unit)}</span></li>`).join('');
    const current = snapshot ? recipeById(recipe.id) : recipe;
    const photo = recipeImage(snapshot ? { ...recipe, photo: current?.photo } : recipe);
    const planned = snapshot ? null : (frequency(state).get(recipe.id)?.planned || 0);
    const body = `<div class="stack">
      ${photo ? `<div class="recipe-cover detail-cover">${photo}</div>` : ''}
      <p class="row"><span class="tag">${escape(recipeCategory(recipe))}${recipe.sample ? ' · Esempio' : ''}${recipe.archived ? ' · Archiviata' : ''}</span>
        ${recipe.componentRole ? `<span class="tag">${componentLabel(recipe.componentRole)}</span>` : ''}
        ${recipeBadges(current || recipe)}</p>
      ${planned === null ? '' : `<p class="muted compact">${planned} ${planned === 1 ? 'volta' : 'volte'} nel piano negli ultimi 30 giorni</p>`}
      <p class="muted">${recipe.pans} pentole o padelle · ${recipe.utensils} utensili</p>
      <h3>Ingredienti per ${recipe.servings} ${recipe.servings === 1 ? 'porzione' : 'porzioni'}</h3>
      <ul class="detail-ingredients">${items}</ul>
      ${recipe.notes ? `<h3>Preparazione</h3><p class="notes">${escape(recipe.notes)}</p>` : ''}
      <h3>Stima per porzione</h3>${macroTiles(totals([{ macros: recipe.macros, portions: 1 }]))}
      ${snapshot ? '' : `<div class="actions">${button('Modifica', 'edit-recipe', recipe.id)}
        ${button('Duplica', 'duplicate-recipe', recipe.id, 'quiet')}
        ${button(recipe.archived ? 'Riattiva' : 'Archivia', 'toggle-archive', recipe.id, 'quiet')}</div>`}
      </div>`;
    showModal(recipe.name, body);
  }

  function compositionDetail(meal, cook) {
    const portionCount = servings(cook);
    const parts = mealRecipes(meal).map(part => {
      const factor = portionCount / part.servings;
      return `<section class="card"><p class="muted compact">${componentLabel(part.componentRole)}</p>
        <h3>${escape(part.name)}</h3><ul class="detail-ingredients">${part.ingredients.map(item =>
          `<li><strong>${escape(item.name)}</strong> <span>${quantity(roundQuantity(item.qty * factor), item.unit)}</span></li>`).join('')}</ul>
        ${part.notes ? `<p class="notes">${escape(part.notes)}</p>` : ''}</section>`;
    }).join('');
    showModal('Piatto componibile', `<div class="stack">
      <h3>Ingredienti per ${portionCount} ${portionCount === 1 ? 'porzione' : 'porzioni'}</h3>${parts}
      <h3>Stima per porzione</h3>${macroTiles(mealTotals(meal))}</div>`);
  }

  function recipeEditor(original, duplicate = false) {
    const recipe = original || { macros: blankMacros(), servings: 2, utensils: 0, pans: 0, ingredients: [{}] };
    const name = duplicate ? recipe.name.slice(0, 132) + ' (copia)' : recipe.name;
    const recipeId = original && !duplicate ? original.id : id();
    const body = `${field('name', 'Nome del piatto', name, { required: true })}
      <label>Uso nel piano<select name="component-role">
        ${option('', 'Piatto completo', recipe.componentRole || '')}
        ${componentRoles.map(({ value, label }) => option(value, 'Componente · ' + label, recipe.componentRole)).join('')}
      </select></label>
      <div class="fields"><label>Categoria<select name="category" required>
        ${option('', 'Scegli', original ? recipeCategory(original) : '')}
        ${recipeCategories.map(value => option(value, value, recipeCategory(original))).join('')}</select></label>
      ${numeric('servings', 'Porzioni della ricetta', recipe.servings, { min: 1, step: 1, required: true })}</div>
      <fieldset class="tag-options"><legend>Tag</legend><div class="row">
        ${recipeTags.map(({ value, label }) => `<label class="check"><input type="checkbox" name="tags" value="${value}"
          ${recipe.tags?.includes(value) ? 'checked' : ''}> ${label}</label>`).join('')}
      </div></fieldset>
      <div class="fields">${numeric('pans', 'Pentole e padelle', recipe.pans, { step: 1, required: true })}
      ${numeric('utensils', 'Utensili', recipe.utensils, { step: 1, required: true })}</div>
      <p class="muted compact">Indica le quantità per tutte le porzioni della ricetta. La lista le adegua alle due porzioni da preparare.</p>
      <div class="stack" id="ingredient-list">${recipe.ingredients.map(ingredientRow).join('')}</div>
      <div>${button('＋ Ingrediente', 'add-ingredient', '', 'quiet')}</div>
      ${notes('Breve preparazione (facoltativa)', recipe.notes)}
      <label>Foto del piatto (facoltativa)<input type="file" name="photo" accept="image/*"></label>
      ${recipe.photo ? '<label class="check"><input type="checkbox" name="remove-photo"> Rimuovi la foto attuale</label>' : ''}
      <h3>Stima per porzione (facoltativa)</h3>${macroFields(recipe.macros)}`;
    showModal(original && !duplicate ? 'Modifica ricetta' : 'Nuova ricetta', form(body), async data => {
      const names = data.getAll('ingredient-name');
      const quantities = data.getAll('ingredient-qty');
      const selectedUnits = data.getAll('ingredient-unit');
      const selectedGroups = data.getAll('ingredient-group');
      const ingredients = names.map((item, index) => ({
        name: item.trim(), qty: Number(quantities[index]), unit: selectedUnits[index], group: selectedGroups[index]
      }));
      const updated = {
        id: recipeId, name: readText(data, 'name'), category: readText(data, 'category'), servings: readNumber(data, 'servings'),
        utensils: readNumber(data, 'utensils'), pans: readNumber(data, 'pans'), notes: readText(data, 'notes'),
        ingredients, tags: data.getAll('tags'), macros: readMacros(data), archived: Boolean(original?.archived && !duplicate)
      };
      const role = data.get('component-role');
      if (role) updated.componentRole = role;
      if (!updated.name || !updated.category || !ingredients.length || ingredients.some(item => !item.name)) {
        throw new Error('Inserisci il nome del piatto, la categoria e il nome di ogni ingrediente.');
      }
      const file = data.get('photo');
      const photo = file?.size ? await resizePhoto(file) : data.has('remove-photo') ? undefined : recipe.photo;
      if (photo) updated.photo = photo;
      if (original?.sample && !duplicate) updated.sample = true;
      await commit(next => {
        const index = next.recipes.findIndex(item => item.id === recipeId);
        if (index === -1) next.recipes.push(updated);
        else next.recipes[index] = updated;
        refreshShoppingChecks(next);
        return next;
      });
      category = '';
      tag = '';
      query = '';
      archivedOnly = updated.archived;
      screen = screen === 'week' ? 'week' : 'recipes';
      return 'Ricetta salvata.';
    });
  }

  async function resizePhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', .72);
    } catch {
      throw new Error('Impossibile aprire la foto. Prova con un’immagine JPEG o PNG.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function clearChangedChecks(record, data, keys = Object.keys(record.checked)) {
    if (!keys.some(key => record.checked[key])) return;
    const needs = new Map(shoppingItems(record, data).map(item => [item.key, item.needed]));
    for (const key of keys) if (needs.get(key) !== record.checked[key]) delete record.checked[key];
  }

  function refreshShoppingChecks(next, keys) {
    for (const record of Object.values(next.weeks)) clearChangedChecks(record, next, keys);
  }

  function pantryEditor(key) {
    const existing = state.pantry[key];
    const item = existing || shoppingItems(week()).find(entry => entry.key === key);
    const unitOptions = units.filter(unit => !item || existing || baseUnit(unit) === item.unit);
    const body = `${field('name', 'Ingrediente', item?.name, { required: true, readOnly: Boolean(item && !existing) })}
      <div class="fields">${numeric('qty', 'Quantità disponibile', existing?.qty ?? '', { min: .000001, required: true })}
      <label>Unità<select name="unit">${unitOptions.map(unit => option(unit, unit, item?.unit || 'g')).join('')}</select></label></div>`;
    showModal(item ? 'Quantità in dispensa' : 'Aggiungi alla dispensa',
      form(body, 'Salva', existing ? button('Rimuovi', 'pantry-remove', key, 'quiet danger') : ''), async data => {
      const unit = readText(data, 'unit');
      const pantryItem = { name: readText(data, 'name'), unit: baseUnit(unit), qty: roundQuantity(amount(readNumber(data, 'qty'), unit)) };
      if (!pantryItem.name || pantryItem.qty <= 0 || pantryItem.qty > limit) throw new Error('Inserisci un ingrediente e una quantità valida.');
      const nextKey = ingredientKey(pantryItem);
      await commit(next => {
        if (nextKey !== key && next.pantry[nextKey]) throw new Error('Questa voce è già in dispensa. Aprila per cambiare la quantità.');
        if (existing) delete next.pantry[key];
        next.pantry[nextKey] = pantryItem;
        refreshShoppingChecks(next, [key, nextKey]);
        return next;
      });
      return 'Dispensa aggiornata.';
    });
  }

  function actionConfirm(label, copy, actionName, value = '', submit = 'Conferma') {
    showModal(label, `<p class="muted">${escape(copy)}</p><p class="form-error" role="alert"></p><div class="actions space">
      ${button('Annulla', 'close', '', 'quiet')}${button(submit, actionName, value)}</div>`);
  }

  function reviewPreparation(cook) {
    const record = week();
    const recipe = record.plan[cook];
    if (!recipe || record.draft || record.prepared?.[cook]) return;
    const items = shopping({ [cook]: recipe }, state.pantry);
    showModal('Registra preparazione', `<div class="stack"><h3>${escape(mealName(recipe))}</h3>
      <p class="muted">Dalla dispensa verranno scalate queste quantità.</p>
      <ul class="detail-ingredients">${items.map(item => `<li><strong>${escape(item.name)}</strong>
        <span>${quantity(Math.min(item.qty, item.available), item.unit)}
          ${item.needed ? `<small>· ${quantity(item.needed, item.unit)} fuori dispensa</small>` : ''}</span></li>`).join('')}</ul>
      <p class="form-error" role="alert"></p><div class="actions">
      ${button('Annulla', 'close', '', 'quiet')}${button('Conferma preparazione', 'prepare', cook)}</div></div>`);
  }

  function backupModal() {
    const message = storage?.mode === 'device' ? 'I dati sono salvati nei file locali di Scriptable su questo iPhone.' :
      storage?.mode === 'browser' ? 'I dati sono salvati nel browser su questo dispositivo.' :
        'Questa sessione è temporanea. Esporta una copia prima di chiudere.';
    showModal('Backup', `<div class="stack"><p>${message}</p>
      <p class="muted">Il backup JSON include ricette, foto, piani e dispensa. L’importazione sostituisce l’archivio corrente dopo la tua conferma.</p>
      <div class="actions">${damaged ? '' : button('Esporta JSON', 'export-backup', '', 'quiet')}${button('Importa JSON', 'choose-backup')}</div>
      <details><summary>Usa il testo del backup</summary>
      <label>Testo JSON<textarea id="backup-text" spellcheck="false" autocapitalize="off"></textarea></label>
      <div class="actions">${damaged ? '' : button('Seleziona il tuo JSON', 'copy-backup', '', 'quiet')}
      ${button('Leggi il JSON incollato', 'paste-backup', '', 'quiet')}</div></details>
      <input type="file" id="backup-file" accept=".json,application/json" hidden>
      <p class="form-error" role="alert"></p></div>`);
    $('#backup-file').addEventListener('change', async event => {
      const [file] = event.target.files;
      if (!file) return;
      try { offerImport(await file.text()); } catch (error) { showError(error); }
      finally { event.target.value = ''; }
    });
  }

  let incoming = null;
  const backupText = () => JSON.stringify(state, null, 2) + '\n';

  function offerImport(raw) {
    try { incoming = validate(JSON.parse(raw.replace(/^\uFEFF/, ''))); }
    catch { throw new Error('Scegli un backup JSON valido di App per la Spesa.'); }
    const plans = Object.values(incoming.weeks).filter(hasPlan).length;
    actionConfirm('Importa backup', `Il file contiene ${incoming.recipes.length} ricette e ${plans} piani confermati. Sostituirà i dati di questo dispositivo.`,
      'restore-backup', '', 'Sostituisci archivio');
  }

  async function exportBackup() {
    const name = `app-per-la-spesa-${today()}.json`;
    const text = backupText();
    if (window.SpesaDevice) {
      const exported = await window.SpesaDevice.call('export', { name, text });
      if (exported) toast('Backup esportato.');
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function showError(error) {
    const message = error?.name === 'QuotaExceededError' ? 'Spazio insufficiente. Esporta un backup e libera spazio sul dispositivo.' :
      error?.message || 'Operazione interrotta. Riprova.';
    const inline = modal.open && modal.querySelector('.form-error');
    if (inline) inline.textContent = message;
    else toast(message, true);
  }

  function changed(message, { close = false } = {}) {
    if (close && modal.open) modal.close();
    render();
    if (message) toast(message);
  }

  async function dispatch(action, value, target) {
    switch (action) {
      case 'nav': navigate(value); break;
      case 'week-step': navigate(screen, shift(weekKey, Number(value))); break;
      case 'week-today': navigate(screen, workWeek()); break;
      case 'pick-day':
        homeDay = Number(value);
        for (const day of app.querySelectorAll('[data-action="pick-day"]')) {
          day.setAttribute('aria-pressed', String(day === target));
        }
        $('#home-nutrients').innerHTML = homeNutrients(week());
        break;
      case 'backup': backupModal(); break;
      case 'settings': settingsModal(); break;
      case 'appearance':
        if (value === currentAppearance()) break;
        await commit(next => { next.appearance = value; return next; });
        applyAppearance();
        modal.querySelectorAll('[data-action="appearance"]').forEach(button => {
          button.setAttribute('aria-pressed', String(button.dataset.value === value));
        });
        break;
      case 'close': modal.close(); break;
      case 'recipe': recipeDetail(recipeById(value)); break;
      case 'edit-recipe': recipeEditor(recipeById(value)); break;
      case 'duplicate-recipe': recipeEditor(recipeById(value), true); break;
      case 'planned-recipe': {
        const record = week();
        const meal = chosenRecipe(state, record, value);
        if (meal?.components) compositionDetail(meal, value);
        else if (meal) recipeDetail(meal, true);
        break;
      }
      case 'add-ingredient': {
        const list = $('#ingredient-list');
        list.insertAdjacentHTML('beforeend', ingredientRow());
        list.lastElementChild.querySelector('input').focus();
        break;
      }
      case 'remove-ingredient': {
        if (target.closest('#ingredient-list').children.length === 1) throw new Error('La ricetta deve avere almeno un ingrediente.');
        target.closest('fieldset').remove();
        break;
      }
      case 'toggle-archive': {
        const recipe = recipeById(value);
        await commit(next => {
          next.recipes.find(item => item.id === value).archived = !recipe.archived;
          refreshShoppingChecks(next);
          return next;
        });
        changed(recipe.archived ? 'Ricetta riattivata.' : 'Ricetta archiviata.', { close: true });
        break;
      }
      case 'load-samples': {
        if (!examples.length) break;
        await commit(next => {
          next.recipes.push(...examples.filter(recipe => !next.recipes.some(item => item.id === recipe.id)));
          return next;
        });
        changed('Esempi caricati.');
        break;
      }
      case 'edit-plan':
        await changeWeek(record => { record.draft = startDraft(record); });
        changed();
        if (value) app.querySelector(`[data-change="component"][data-value="${value}"]`)?.focus();
        break;
      case 'suggest':
        await changeWeek((record, next, key) => {
          const draft = record.draft || startDraft(record);
          const picks = suggest(next, key, draft);
          const locked = draft.locked.filter(cook => record.prepared?.[cook] || picks[cook] === draft.picks[cook]);
          record.draft = { picks, locked };
        });
        changed();
        break;
      case 'discard-draft':
        await changeWeek(record => { record.draft = null; });
        changed('Bozza scartata.');
        break;
      case 'confirm-plan':
        await changeWeek((record, next) => {
          const picks = preparations.map(({ cook }) => [cook, chosenRecipe(next, record, cook)]);
          if (!picks.every(([, meal]) => meal)) throw new Error('Scegli un piatto per ogni sera.');
          record.plan = Object.fromEntries(picks.map(([cook, meal]) => [cook, mealSnapshot(meal)]));
          record.draft = null;
        });
        changed('Piano confermato. La lista della spesa è pronta.');
        break;
      case 'pantry-edit': pantryEditor(value); break;
      case 'stock-purchases':
        await changeWeek((record, next) => {
          const purchased = shoppingItems(record, next).filter(item => item.needed && record.checked[item.key] === item.needed);
          const keys = purchased.map(item => addStock(next.pantry, item, item.needed));
          refreshShoppingChecks(next, keys);
        });
        changed('Acquisti aggiunti alla dispensa.');
        break;
      case 'review-prepare': reviewPreparation(value); break;
      case 'review-undo':
        actionConfirm('Annulla preparazione', 'Le quantità scalate verranno rimesse in dispensa e la ricetta tornerà tra quelle da preparare.',
          'undo-preparation', value, 'Annulla preparazione');
        break;
      case 'prepare':
        await changeWeek((record, next) => {
          const keys = prepare(record, next.pantry, value);
          refreshShoppingChecks(next, keys);
        });
        changed('Preparazione registrata. Dispensa aggiornata.', { close: true });
        break;
      case 'undo-preparation':
        await changeWeek((record, next) => {
          const keys = undoPreparation(record, next.pantry, value);
          refreshShoppingChecks(next, keys);
        });
        changed('Preparazione annullata. Dispensa aggiornata.', { close: true });
        break;
      case 'pantry-remove':
        await commit(next => {
          delete next.pantry[value];
          refreshShoppingChecks(next, [value]);
          return next;
        });
        changed('Voce rimossa dalla dispensa.', { close: true });
        break;
      case 'export-backup': await exportBackup(); break;
      case 'copy-backup': {
        const field = $('#backup-text');
        field.value = backupText();
        field.focus();
        field.select();
        break;
      }
      case 'paste-backup':
        offerImport($('#backup-text').value);
        break;
      case 'choose-backup': {
        if (!window.SpesaDevice) {
          $('#backup-file').click();
          break;
        }
        const raw = await window.SpesaDevice.call('import');
        if (raw) offerImport(raw);
        break;
      }
      case 'restore-backup':
        if (!incoming) break;
        await commit(() => incoming, { replace: true });
        incoming = null;
        query = '';
        category = '';
        tag = '';
        archivedOnly = false;
        modal.close();
        navigate('home', workWeek());
        toast('Backup importato.');
        break;
    }
  }

  document.addEventListener('click', async event => {
    const target = event.target.closest('button[data-action]');
    if (!target || saving || submitting) return;
    const { action, value } = target.dataset;
    if (!['backup', 'close'].includes(action) && !storage) return;
    if (modal.open) modal.querySelector('.form-error')?.replaceChildren();
    try { await dispatch(action, value, target); }
    catch (error) { showError(error); }
  });

  document.addEventListener('input', event => {
    if (event.target.id !== 'recipe-search') return;
    query = event.target.value;
    $('#recipe-results').innerHTML = recipeResults();
  });

  document.addEventListener('change', async event => {
    const { change, value } = event.target.dataset;
    if (!change) return;
    if (saving) { render(); return; }
    const input = event.target;
    try {
      if (change === 'category') category = input.value;
      if (change === 'tag') tag = input.value;
      if (change === 'category' || change === 'tag') {
        $('#recipe-results').innerHTML = recipeResults();
        return;
      }
      if (change === 'archive-filter') archivedOnly = input.checked;
      if (['meal-type', 'pick', 'component', 'lock'].includes(change)) {
        await changeWeek(record => {
          if (!record.draft || record.prepared?.[value]) return;
          if (change === 'meal-type') {
            if (input.value === 'componibile') record.draft.picks[value] = { components: {} };
            else delete record.draft.picks[value];
          }
          if (change === 'pick') {
            if (input.value) record.draft.picks[value] = input.value;
            else delete record.draft.picks[value];
          }
          if (change === 'component') {
            const components = record.draft.picks[value]?.components;
            if (!components) return;
            const role = input.dataset.role;
            if (input.value) components[role] = input.value;
            else delete components[role];
          }
          record.draft.locked = record.draft.locked.filter(cook => cook !== value);
          if (change === 'lock' && input.checked) record.draft.locked.push(value);
        });
      }
      if (change === 'shop-check') {
        await changeWeek((record, next) => {
          const item = shoppingItems(record, next).find(item => item.key === value);
          if (input.checked && item?.needed) record.checked[value] = item.needed;
          else delete record.checked[value];
        });
        const record = week();
        const buy = shoppingItems(record).filter(item => item.needed);
        const checked = buy.filter(item => record.checked[item.key] === item.needed).length;
        const progress = $('#shopping-progress');
        if (progress) progress.textContent = `${checked} / ${buy.length} spuntate`;
        const stock = $('#stock-purchases');
        if (stock) stock.disabled = checked === 0;
        return;
      }
      render();
    } catch (error) {
      render();
      showError(error);
    }
  });

  modal.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || submitting || !modalSubmit) return;
    submitting = true;
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    event.target.querySelector('.form-error').textContent = '';
    try { changed(await modalSubmit(new FormData(event.target)), { close: true }); }
    catch (error) { showError(error); }
    finally {
      submitting = false;
      if (submit) submit.disabled = false;
    }
  });

  modal.addEventListener('cancel', event => { if (saving || submitting) event.preventDefault(); });
  modal.addEventListener('close', () => { modalSubmit = null; });

  async function start() {
    applyAppearance();
    systemAppearance?.addEventListener?.('change', applyAppearance);
    try {
      storage = await Storage.open();
      storedRaw = storage.raw;
      if (storedRaw !== null) state = validate(JSON.parse(storedRaw));
    } catch (error) {
      damaged = Boolean(storage);
      if (!storage) {
        app.innerHTML = title('Archivio non disponibile') + emptyCard('Riapri l’app', 'Impossibile leggere il file locale. Dopo la riapertura, usa Backup per ripristinare una copia se necessario.');
        return;
      }
    }
    render();
    if (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      navigator.serviceWorker?.register('./sw.js').catch(() => {});
    }
  }

  start();
})();

'use strict';

const Model = (() => {
  const slots = [
    { id: 'lun-cena', offset: 0, label: 'Lunedì cena', day: 'Lunedì', meal: 'Cena', cook: 'lun', prepares: true },
    { id: 'mar-pranzo', offset: 1, label: 'Martedì pranzo', day: 'Martedì', meal: 'Pranzo', cook: 'lun' },
    { id: 'mar-cena', offset: 1, label: 'Martedì cena', day: 'Martedì', meal: 'Cena', cook: 'mar', prepares: true },
    { id: 'mer-pranzo', offset: 2, label: 'Mercoledì pranzo', day: 'Mercoledì', meal: 'Pranzo', cook: 'mar' },
    { id: 'mer-cena', offset: 2, label: 'Mercoledì cena', day: 'Mercoledì', meal: 'Cena', cook: 'mer', prepares: true },
    { id: 'gio-pranzo', offset: 3, label: 'Giovedì pranzo', day: 'Giovedì', meal: 'Pranzo', cook: 'mer' }
  ];
  const preparations = slots.filter(slot => slot.prepares);
  const servings = cook => slots.filter(slot => slot.cook === cook).length;
  const groups = ['Ortofrutta', 'Carne e pesce', 'Latticini e uova', 'Dispensa', 'Surgelati', 'Altro'];
  const units = ['g', 'kg', 'ml', 'l', 'pz'];
  const appearances = [
    { value: 'system', label: 'Automatico' },
    { value: 'light', label: 'Chiaro' },
    { value: 'dark', label: 'Scuro' }
  ];
  const recipeTags = [
    { value: 'piatto-pronto', label: 'Piatto pronto' },
    { value: 'veloce', label: 'Veloce' },
    { value: 'senza-preparazione', label: 'Senza preparazione' }
  ];
  const componentRoles = [
    { value: 'carboidrati', label: 'Carboidrati' },
    { value: 'proteine', label: 'Proteine' },
    { value: 'verdure', label: 'Contorni e verdure' }
  ];
  const recipeCategories = ['Carne', 'Pesce', 'Legumi', 'Verdura', 'Cereali e tuberi', 'Uova', 'Latticini', 'Misto', 'Altro'];
  const categoryAliases = [
    /\b(carne|pollo|tacchino|manzo|maiale|vitello|salumi)\b/,
    /\b(pesce|salmone|tonno|crostacei|molluschi)\b/,
    /\b(legumi|ceci|fagioli|lenticchie|tofu)\b/,
    /\b(verdura|verdure|ortaggi|contorno|contorni|ortofrutta)\b/,
    /\b(cereali|pasta|riso|pane|patate|tuberi)\b/,
    /\b(uova|uovo)\b/,
    /\b(latticini|formaggi|formaggio|yogurt)\b/
  ];
  const nutrients = { kcal: 'Calorie', protein: 'Proteine', carbs: 'Carboidrati', fat: 'Grassi' };
  const nutrientEntries = Object.entries(nutrients);
  const blankMacros = () => Object.fromEntries(nutrientEntries.map(([key]) => [key, null]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const date = key => new Date(key + 'T12:00:00');
  const iso = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  function shift(key, days) {
    const d = date(key);
    d.setDate(d.getDate() + days);
    return iso(d);
  }
  const monday = key => shift(key, -((date(key).getDay() + 6) % 7));
  const today = () => iso(new Date());
  function workWeek(key = today()) {
    const start = monday(key);
    return key > shift(start, slots.at(-1).offset) ? shift(start, 7) : start;
  }

  const normalize = s => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');
  const baseUnit = unit => ({ kg: 'g', l: 'ml' })[unit] || unit;
  const amount = (value, unit) => ['kg', 'l'].includes(unit) ? value * 1000 : value;
  const roundQuantity = value => Number(value.toFixed(6));
  const ingredientKey = item => JSON.stringify([normalize(item.name), baseUnit(item.unit)]);
  const emptyWeek = () => ({ draft: null, plan: {}, diary: {}, checked: {}, prepared: {} });
  const empty = () => ({ version: 1, recipes: [], weeks: {}, pantry: {} });

  function recipeCategory(recipe) {
    if (!recipe) return '';
    const label = normalize(recipe.category);
    const exact = recipeCategories.find(category => normalize(category) === label);
    if (exact) return exact;
    const matches = recipeCategories.filter((_, index) => categoryAliases[index]?.test(label));
    return matches.length > 1 ? 'Misto' : matches[0] || 'Altro';
  }

  const samples = () => typeof spesaExamples === 'function' ? spesaExamples(groups) : [];

  const mapComponents = (meal, transform) => Object.fromEntries(componentRoles.flatMap(({ value }) =>
    meal.components[value] ? [[value, transform(meal.components[value], value)]] : []));
  const mealRecipes = meal => meal?.components ? Object.values(mapComponents(meal, recipe => recipe)) : meal ? [meal] : [];
  const mealName = meal => mealRecipes(meal).map(recipe => recipe.name).join(' + ');
  const draftPick = meal => meal.components ? { components: mapComponents(meal, recipe => recipe.id) } : meal.id;

  function mealSnapshot(meal) {
    if (meal.components) return { components: mapComponents(meal, mealSnapshot) };
    const { photo, ...recipe } = meal;
    return clone(recipe);
  }

  const mealTotals = meal => totals(mealRecipes(meal).map(({ macros }) => ({ macros, portions: 1 })));

  const plannedEntries = ({ plan }, offset) => slots.flatMap(slot => {
    if (offset !== undefined && slot.offset !== offset) return [];
    const meal = plan[slot.cook];
    if (!meal) return [];
    const fields = Object.entries(mealTotals(meal));
    return [{ meal: slot.meal, portions: 1,
      macros: Object.fromEntries(fields.map(([key, summary]) => [key, summary.value])),
      partial: Object.fromEntries(fields.map(([key, summary]) => [key, summary.partial])) }];
  });

  function totals(entries) {
    return Object.fromEntries(nutrientEntries.map(([key]) => {
      const known = entries.filter(entry => entry.macros[key] !== null);
      return [key, {
        value: known.length ? known.reduce((sum, entry) => sum + entry.macros[key] * entry.portions, 0) : null,
        partial: known.length < entries.length || known.some(entry => entry.partial?.[key])
      }];
    }));
  }

  function frequency(state, reference = today()) {
    const start = shift(reference, -29);
    const counts = new Map();
    function count(id, field) {
      const entry = counts.get(id) || { planned: 0, logged: 0 };
      entry[field]++;
      counts.set(id, entry);
    }
    for (const [week, record] of Object.entries(state.weeks)) {
      for (const slot of slots) {
        const day = shift(week, slot.offset);
        if (day < start || day > reference) continue;
        const recipe = slot.prepares && record.plan[slot.cook];
        const meal = record.diary[slot.id];
        for (const part of mealRecipes(recipe)) count(part.id, 'planned');
        if (meal?.recipeId) count(meal.recipeId, 'logged');
      }
    }
    return counts;
  }

  function suggest(state, week, draft) {
    const recentStart = shift(week, -30);
    const previousWeek = shift(week, -7);
    const history = new Map();
    const mealHistory = new Map();
    const signature = meal => JSON.stringify(draftPick(meal));
    const recordVisit = (days, key, day) => {
      const visits = days.get(key) || [];
      visits.push(day);
      days.set(key, visits);
    };
    for (const [key, record] of Object.entries(state.weeks)) {
      if (key >= week || shift(key, slots.at(-1).offset) < recentStart) continue;
      for (const { cook, offset } of preparations) {
        const day = shift(key, offset);
        if (day < recentStart) continue;
        const planned = record.plan[cook];
        const logged = slots.filter(slot => slot.cook === cook).map(slot => record.diary[slot.id]?.recipeId);
        for (const id of new Set([...mealRecipes(planned).map(recipe => recipe.id), ...logged].filter(Boolean))) {
          recordVisit(history, id, day);
        }
        if (planned?.components) recordVisit(mealHistory, signature(planned), day);
      }
    }
    const recipes = state.recipes.filter(recipe => !recipe.archived);
    if (!recipes.length) return { ...draft.picks };
    const picks = {};
    const use = new Map();
    const usedMeals = new Map();
    const formats = new Map();
    const categories = new Map();
    const increment = (counts, key) => counts.set(key, (counts.get(key) || 0) + 1);
    const add = (cook, meal, selection = draftPick(meal)) => {
      picks[cook] = selection;
      increment(usedMeals, signature(meal));
      increment(formats, Boolean(meal.components));
      for (const recipe of mealRecipes(meal)) {
        increment(use, recipe.id);
        increment(categories, recipeCategory(recipe));
      }
    };
    const record = state.weeks[week];
    for (const cook of new Set([...draft.locked, ...Object.keys(record?.prepared || {})])) {
      if (record?.prepared?.[cook]) {
        add(cook, record.plan[cook]);
        continue;
      }
      const meal = draftRecipe(state, record, cook, draft.picks[cook]);
      if (meal) add(cook, meal, draft.picks[cook]);
    }
    const complete = recipes.filter(recipe => !recipe.componentRole);
    const pools = componentRoles.map(({ value }) => [value, recipes.filter(recipe => recipe.componentRole === value)])
      .filter(([, pool]) => pool.length);
    const priority = (count, visits = []) => [
      count || 0, Number(visits.some(day => day >= previousWeek)), visits.length
    ];
    const compare = (left, right) => {
      for (const [index, value] of left.entries()) {
        if (value !== right[index]) return value - right[index];
      }
      return 0;
    };
    function* combinations(pools, index, components) {
      if (index === pools.length) {
        yield { components };
        return;
      }
      const [role, pool] = pools[index];
      for (const recipe of pool) yield* combinations(pools, index + 1, { ...components, [role]: recipe });
    }
    for (const { cook } of preparations) {
      if (picks[cook]) continue;
      const orderedPools = pools.map(([role, pool]) => {
        const ranked = pool.map(recipe => ({ recipe, score: [
          ...priority(use.get(recipe.id), history.get(recipe.id)), categories.get(recipeCategory(recipe)) || 0, Math.random()
        ] })).sort((left, right) => compare(left.score, right.score));
        return [role, ranked.map(({ recipe }) => recipe)];
      });
      const candidates = [...complete];
      if (orderedPools.length) {
        const components = Object.fromEntries(orderedPools.map(([role, pool]) => [role, pool[0]]));
        candidates.push({ components });
        for (const [role, pool] of orderedPools) {
          for (const recipe of pool.slice(1)) candidates.push({ components: { ...components, [role]: recipe } });
        }
        // Stop as soon as a combination absent from both the week and recent history is found.
        const candidateKeys = new Set(candidates.map(signature));
        if (!candidates.some(meal => meal.components && !usedMeals.has(signature(meal)) && !mealHistory.has(signature(meal)))) {
          for (const meal of combinations(orderedPools, 0, {})) {
            const key = signature(meal);
            if (!candidateKeys.has(key)) candidates.push(meal);
            if (!usedMeals.has(key) && !mealHistory.has(key)) break;
          }
        }
      }
      const ranked = candidates.map(meal => {
        const parts = mealRecipes(meal);
        const average = score => parts.reduce((sum, recipe) => sum + score(recipe), 0) / parts.length;
        const key = signature(meal);
        const visits = meal.components ? mealHistory.get(key) : history.get(meal.id);
        return { meal, score: [
          ...priority(usedMeals.get(key), visits), formats.get(Boolean(meal.components)) || 0,
          average(recipe => use.get(recipe.id) || 0),
          average(recipe => history.get(recipe.id)?.length || 0),
          average(recipe => categories.get(recipeCategory(recipe)) || 0),
          Math.random()
        ] };
      }).sort((left, right) => compare(left.score, right.score));
      add(cook, ranked[0].meal);
    }
    return picks;
  }

  function draftRecipe(state, record, cook, pick) {
    if (!pick) return null;
    const saved = record?.plan[cook];
    const resolve = (id, prior, role) => prior?.id === id ? prior :
      state.recipes.find(recipe => recipe.id === id && !recipe.archived && recipe.componentRole === role);
    if (!pick.components) return resolve(pick, saved);
    const components = mapComponents(pick, (id, role) => resolve(id, saved?.components?.[role], role));
    const parts = Object.values(components);
    return parts.length && parts.every(Boolean) ? { components } : null;
  }

  function chosenRecipe(state, record, cook) {
    if (!record.draft || record.prepared?.[cook]) return record.plan[cook];
    return draftRecipe(state, record, cook, record.draft.picks[cook]);
  }

  function shoppingPlan(state, record) {
    const plan = {};
    for (const { cook } of preparations) {
      const recipe = chosenRecipe(state, record, cook);
      if (recipe && !record.prepared?.[cook]) plan[cook] = recipe;
    }
    return plan;
  }

  function shopping(plan, pantry) {
    const items = new Map();
    for (const { cook } of preparations) {
      for (const recipe of mealRecipes(plan[cook])) {
        const factor = servings(cook) / recipe.servings;
        for (const item of recipe.ingredients) {
          const key = ingredientKey(item);
          if (!items.has(key)) items.set(key, { ...item, key, unit: baseUnit(item.unit), qty: 0 });
          items.get(key).qty += amount(item.qty, item.unit) * factor;
        }
      }
    }
    return [...items.values()].map(item => {
      const qty = roundQuantity(item.qty);
      const available = pantry[item.key]?.qty || 0;
      return { ...item, qty, available, needed: Math.max(0, roundQuantity(qty - available)) };
    }).sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }

  function addStock(pantry, item, qty) {
    const key = ingredientKey(item);
    const existing = pantry[key];
    pantry[key] = { name: existing?.name || item.name, unit: item.unit, qty: roundQuantity((existing?.qty || 0) + qty) };
    return key;
  }

  function prepare(record, pantry, cook) {
    const recipe = record.plan[cook];
    if (record.draft || !recipe || record.prepared?.[cook]) {
      throw new Error('Conferma il piano e scegli una ricetta ancora da preparare.');
    }
    const used = [];
    for (const item of shopping({ [cook]: recipe }, pantry)) {
      const qty = Math.min(item.qty, item.available);
      if (qty <= 0) continue;
      const left = roundQuantity(item.available - qty);
      if (left > 0) pantry[item.key].qty = left;
      else delete pantry[item.key];
      used.push({ name: item.name, unit: item.unit, qty });
    }
    (record.prepared ??= {})[cook] = used;
    return used.map(ingredientKey);
  }

  function undoPreparation(record, pantry, cook) {
    const used = record.prepared?.[cook];
    if (record.draft || !used) throw new Error('Apri il piano confermato per annullare la preparazione.');
    delete record.prepared[cook];
    return used.map(item => addStock(pantry, item, item.qty));
  }

  function validate(data) {
    const record = v => v && typeof v === 'object' && !Array.isArray(v);
    const str = v => typeof v === 'string' && v.trim().length > 0;
    const num = v => Number.isFinite(v) && v >= 0 && v <= 1e12;
    const positive = v => num(v) && v > 0;
    const count = v => num(v) && Number.isInteger(v);
    const stock = v => record(v) && str(v.name) && positive(v.qty) && ['g', 'ml', 'pz'].includes(v.unit);
    const macro = v => record(v) && nutrientEntries.every(([key]) => v[key] === null || num(v[key]));
    const ingredient = v => record(v) && str(v.name) && positive(v.qty) && units.includes(v.unit) && groups.includes(v.group);
    const photo = v => typeof v === 'string' && v.length <= 550000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v);
    const tags = v => Array.isArray(v) && new Set(v).size === v.length &&
      v.every(value => recipeTags.some(tag => tag.value === value));
    const recipe = v => record(v) && v.components === undefined && str(v.id) && str(v.name) && str(v.category) && macro(v.macros) &&
      count(v.servings) && v.servings > 0 && Array.isArray(v.ingredients) && v.ingredients.length > 0 &&
      v.ingredients.every(ingredient) && count(v.utensils) && count(v.pans) && typeof v.notes === 'string' &&
      typeof v.archived === 'boolean' && (v.photo === undefined || photo(v.photo)) &&
      (v.tags === undefined || tags(v.tags)) &&
      (v.componentRole === undefined || componentRoles.some(role => role.value === v.componentRole));
    const diary = v => record(v) && (v.recipeId === null || str(v.recipeId)) && str(v.name) && macro(v.macros) &&
      positive(v.portions) && typeof v.notes === 'string';
    const map = (v, check) => record(v) && Object.entries(v).every(([key, item]) => check(key, item));
    const cookId = k => preparations.some(slot => slot.cook === k);
    const components = (v, check) => record(v) && map(v.components,
      (key, item) => componentRoles.some(role => role.value === key) && check(item, key));
    const pick = v => str(v) || components(v, str);
    const meal = v => recipe(v) || (components(v, (part, role) => recipe(part) && part.componentRole === role) &&
      Object.keys(v.components).length > 0 && new Set(Object.values(v.components).map(part => part.id)).size === Object.keys(v.components).length);
    const draft = v => v === null || (record(v) && map(v.picks, (key, value) => cookId(key) && pick(value)) &&
      Array.isArray(v.locked) && v.locked.every(key => cookId(key) && v.picks[key]));
    const week = (key, w) => /^\d{4}-\d{2}-\d{2}$/.test(key) && iso(date(key)) === key && monday(key) === key &&
      record(w) && draft(w.draft) && map(w.plan, (k, r) => cookId(k) && meal(r)) &&
      map(w.diary, (k, entry) => slots.some(slot => slot.id === k) && diary(entry)) &&
      map(w.checked, (k, qty) => Number.isFinite(qty) && qty > 0) &&
      (w.prepared === undefined || map(w.prepared, (k, used) => cookId(k) && w.plan[k] && Array.isArray(used) && used.every(stock)));
    if (!record(data) || data.version !== 1 ||
        (data.appearance !== undefined && !appearances.some(mode => mode.value === data.appearance)) ||
        !Array.isArray(data.recipes) || !data.recipes.every(recipe) ||
        new Set(data.recipes.map(r => r.id)).size !== data.recipes.length || !map(data.weeks, week) ||
        !map(data.pantry, (key, item) => stock(item) && ingredientKey(item) === key)) {
      throw new Error('Il file non è un backup valido di App per la Spesa (versione 1).');
    }
    return data;
  }

  return { slots, preparations, servings, groups, units, appearances, recipeTags, nutrientEntries, blankMacros, clone, emptyWeek, empty, samples,
    recipeCategories, recipeCategory, componentRoles, mealName, mealTotals, mealRecipes, draftPick, mealSnapshot,
    date, shift, monday, today, workWeek, plannedEntries, totals, frequency, suggest, draftRecipe, chosenRecipe,
    shoppingPlan, shopping, addStock, prepare, undoPreparation, validate, normalize, ingredientKey, baseUnit, amount, roundQuantity };
})();

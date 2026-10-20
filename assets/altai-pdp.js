/* ALTAÏ — page produit : carrousels, galerie, packs, date de livraison, avis, vidéos. */

const formatMoney = (cents, format) => {
  const fmt = format || window.themeVariables?.settings?.moneyFormat || '${{amount}}';
  const match = fmt.match(/\{\{\s*(\w+)\s*\}\}/);
  if (!match) return fmt;
  const styles = {
    amount: [2, ',', '.'],
    amount_no_decimals: [0, ',', '.'],
    amount_with_comma_separator: [2, '.', ','],
    amount_no_decimals_with_comma_separator: [0, '.', ','],
    amount_with_apostrophe_separator: [2, "'", '.'],
    amount_with_space_separator: [2, ' ', ','],
    amount_no_decimals_with_space_separator: [0, ' ', ',']
  };
  const [decimals, thousands, decimalSep] = styles[match[1]] || styles.amount;
  const [int, frac] = (Math.round(cents) / 100).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return fmt.replace(match[0], frac ? grouped + decimalSep + frac : grouped);
};

/* Carrousel à défilement natif, avec flèches et points */
class AltaiCarousel extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector(':scope [data-track]');
    if (!this.track || this._ready) return;
    this._ready = true;
    this.dotsEl = this.querySelector(':scope > .ap-nav [data-dots], :scope [data-dots]');
    this.querySelectorAll(':scope [data-prev]').forEach((b) => b.addEventListener('click', () => this.go(this.index - 1)));
    this.querySelectorAll(':scope [data-next]').forEach((b) => b.addEventListener('click', () => this.go(this.index + 1)));
    this.track.addEventListener('scroll', () => {
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this.update());
    }, { passive: true });
    // Le premier rappel du ResizeObserver construit le carrousel une fois affiché :
    // pas de calcul de mise en page forcé au chargement.
    new ResizeObserver(() => this.build()).observe(this.track);
  }

  get step() {
    const items = this.track.children;
    if (items.length < 2) return this.track.clientWidth || 1;
    return items[1].offsetLeft - items[0].offsetLeft || this.track.clientWidth || 1;
  }

  get pages() {
    const max = this.track.scrollWidth - this.track.clientWidth;
    return max <= 2 ? 1 : Math.round(max / this.step) + 1;
  }

  get index() {
    return Math.min(this.pages - 1, Math.round(this.track.scrollLeft / this.step));
  }

  build() {
    const pages = this.pages;
    this.classList.toggle('is-static', pages <= 1);
    if (this.dotsEl) {
      this.dotsEl.innerHTML = '';
      if (pages > 1) {
        for (let i = 0; i < pages; i++) {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'ap-dot';
          dot.setAttribute('aria-label', `${i + 1} / ${pages}`);
          dot.addEventListener('click', () => this.go(i));
          this.dotsEl.appendChild(dot);
        }
      }
    }
    this.update();
  }

  go(i) {
    const pages = this.pages;
    const target = (i + pages) % pages;
    this.track.scrollTo({ left: target * this.step, behavior: 'smooth' });
  }

  update() {
    const i = this.index;
    this.dotsEl?.querySelectorAll('.ap-dot').forEach((d, n) => d.classList.toggle('is-active', n === i));
    this.dispatchEvent(new CustomEvent('altai:slide', { detail: { index: i } }));
  }
}
if (!customElements.get('altai-carousel')) customElements.define('altai-carousel', AltaiCarousel);

/* Galerie : image principale + vignettes synchronisées */
class AltaiGallery extends HTMLElement {
  connectedCallback() {
    this.main = this.querySelector('[data-gallery-main]');
    this.thumbs = [...this.querySelectorAll('[data-thumb]')];
    if (!this.main) return;
    this.main.addEventListener('altai:slide', (e) => {
      if (e.detail.index > 0) this.loadSlides();
      this.setActive(e.detail.index);
    });
    this.thumbs.forEach((thumb, i) => thumb.addEventListener('click', () => this.main.go(i)));
    const wake = () => this.loadSlides();
    ['pointerdown', 'pointerenter', 'touchstart', 'focusin', 'wheel'].forEach((type) => this.addEventListener(type, wake, { once: true, passive: true }));
    this.main.querySelector('[data-track]')?.addEventListener('scroll', wake, { once: true, passive: true });
  }

  // Les images 2 et suivantes n'ont pas de src au chargement (data-src / data-srcset).
  loadSlides() {
    if (this._slidesLoaded) return;
    this._slidesLoaded = true;
    this.querySelectorAll('img[data-src]').forEach((img) => {
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      img.src = img.dataset.src;
      img.removeAttribute('data-srcset');
      img.removeAttribute('data-src');
    });
  }

  setActive(i) {
    this.thumbs.forEach((thumb, n) => {
      thumb.classList.toggle('is-active', n === i);
      if (n === i) {
        const strip = thumb.closest('[data-track]');
        const item = thumb.parentElement;
        if (strip && item) strip.scrollTo({ left: Math.max(0, item.offsetLeft - strip.clientWidth / 2 + item.clientWidth / 2), behavior: 'smooth' });
      }
    });
  }
}
if (!customElements.get('altai-gallery')) customElements.define('altai-gallery', AltaiGallery);

/* Bloc d'achat : variantes, packs, prix, bouton */
class AltaiBuybox extends HTMLElement {
  connectedCallback() {
    const data = this.querySelector('[data-product-json]');
    this.variants = data ? JSON.parse(data.textContent) : [];
    this.form = this.querySelector('form[is="product-form"], form');
    this.addEventListener('change', (e) => {
      if (e.target.matches('[data-variant-input], [data-tier-input]')) this.update();
    });
    this.update();
    this.querySelectorAll('[data-delivery]').forEach((el) => this.renderDelivery(el));
  }

  get variant() {
    const checked = this.querySelector('[data-variant-input]:checked');
    const id = checked ? Number(checked.value) : Number(this.form?.querySelector('[name="id"]')?.value);
    return this.variants.find((v) => v.id === id) || this.variants[0];
  }

  tierPrices(variant, qty, discount) {
    const price = Math.round(variant.price * qty * (100 - discount) / 100);
    const unitCompare = variant.compare_at_price > variant.price ? variant.compare_at_price : variant.price;
    const compare = unitCompare * qty;
    return { price, compare: compare > price ? compare : 0, unit: Math.round(price / qty) };
  }

  update() {
    const variant = this.variant;
    if (!variant) return;
    const idInput = this.form?.querySelector('[name="id"]');
    if (idInput) idInput.value = variant.id;

    this.querySelectorAll('[data-tier-input]').forEach((input) => {
      const box = input.closest('[data-tier]');
      const t = this.tierPrices(variant, Number(input.dataset.qty), Number(input.dataset.discount || 0));
      box.querySelector('[data-tier-price]') && (box.querySelector('[data-tier-price]').textContent = formatMoney(t.price));
      const cmp = box.querySelector('[data-tier-compare]');
      if (cmp) { cmp.textContent = t.compare ? formatMoney(t.compare) : ''; cmp.hidden = !t.compare; }
      const unit = box.querySelector('[data-tier-unit]');
      if (unit) unit.textContent = unit.dataset.template.replace('[price]', formatMoney(t.unit));
    });

    const tier = this.querySelector('[data-tier-input]:checked');
    const qty = tier ? Number(tier.dataset.qty) : 1;
    const t = this.tierPrices(variant, qty, tier ? Number(tier.dataset.discount || 0) : 0);
    const qtyInput = this.form?.querySelector('[name="quantity"]');
    if (qtyInput) qtyInput.value = qty;

    this.querySelectorAll('[data-price]').forEach((el) => (el.textContent = formatMoney(t.price)));
    this.querySelectorAll('[data-compare]').forEach((el) => { el.textContent = t.compare ? formatMoney(t.compare) : ''; el.hidden = !t.compare; });
    this.querySelectorAll('[data-save]').forEach((el) => {
      el.hidden = !t.compare;
      const amount = el.querySelector('[data-save-amount]');
      if (amount) amount.textContent = formatMoney(t.compare - t.price);
    });

    const button = this.querySelector('[data-atc]');
    if (button) {
      button.disabled = !variant.available;
      const label = button.querySelector('[data-atc-label]');
      if (label) label.textContent = variant.available ? label.dataset.available : label.dataset.soldOut;
    }
  }

  renderDelivery(el) {
    const add = Number(el.dataset.days || 5);
    const date = new Date();
    let added = 0;
    while (added < add) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    const target = el.querySelector('[data-delivery-date]');
    if (target) target.textContent = date.toLocaleDateString(el.dataset.locale || 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
}
if (!customElements.get('altai-buybox')) customElements.define('altai-buybox', AltaiBuybox);

/* Compte à rebours jusqu'à une date de fin réelle */
class AltaiCountdown extends HTMLElement {
  connectedCallback() {
    const { date, time, offset } = this.dataset;
    this.end = new Date(`${date}T${time || '23:59'}:00${offset || 'Z'}`).getTime();
    if (Number.isNaN(this.end)) { this.hidden = true; return; }
    this.tick();
    this._timer = setInterval(() => this.tick(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  tick() {
    let left = Math.max(0, Math.floor((this.end - Date.now()) / 1000));
    if (left === 0) {
      clearInterval(this._timer);
      if (this.dataset.hideWhenOver === 'true') { this.hidden = true; return; }
    }
    const days = Math.floor(left / 86400); left %= 86400;
    const parts = { days, hours: Math.floor(left / 3600), minutes: Math.floor((left % 3600) / 60), seconds: left % 60 };
    Object.entries(parts).forEach(([unit, value]) => {
      const el = this.querySelector(`[data-cd="${unit}"]`);
      if (el) el.textContent = String(value).padStart(2, '0');
    });
    this.querySelectorAll('[data-cd-days]').forEach((el) => (el.hidden = days === 0));
    this.hidden = false;
  }
}
if (!customElements.get('altai-countdown')) customElements.define('altai-countdown', AltaiCountdown);

/* « Lire plus d'avis » et vidéos UGC */
document.addEventListener('click', (event) => {
  const more = event.target.closest('[data-more]');
  if (more) {
    more.closest('[data-more-scope]')?.querySelectorAll('[data-extra]').forEach((el) => (el.hidden = false));
    more.hidden = true;
  }

  const play = event.target.closest('[data-play]');
  if (play) {
    const card = play.closest('.ap-ugc__card');
    const video = card?.querySelector('video');
    if (video) {
      video.controls = true;
      video.play();
      card.classList.add('is-playing');
    }
  }
});

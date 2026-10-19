import { Component, type ReactNode } from 'react';
import { useApp } from '../store/appStore';
import { recordError } from './errorReport';

/**
 * Ошибка при отрисовке раздела (например, повреждённая карта из файла) — вместо белого экрана
 * сообщение и выход: «На главную» или «Перезапустить». Сбрасывается при смене раздела (key = раздел).
 */
export class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Раздел не отрисовался', error);
    recordError(error, 'crash');
  }

  render() {
    if (!this.state.error) return this.props.children;
    const home = () => {
      const app = useApp.getState();
      if (app.view === 'editor') void import('../store/docStore').then((m) => m.useDoc.getState().close());
      app.go('home');
    };
    return (
      <div className="view-crash" role="alert">
        <h2>Этот раздел не открылся</h2>
        <p className="muted">Что-то в данных помешало его показать. Ваши данные на месте — попробуйте вернуться на главную или перезапустить приложение.</p>
        <p className="tiny faint view-crash-msg">{String(this.state.error.message || this.state.error).slice(0, 200)}</p>
        <div className="row view-crash-acts">
          <button className="btn" onClick={() => location.reload()}>
            Перезапустить
          </button>
          <button className="btn btn-primary" onClick={home}>
            На главную
          </button>
        </div>
      </div>
    );
  }
}

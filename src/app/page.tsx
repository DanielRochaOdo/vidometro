import { Dashboard } from "../components/dashboard";

export default function Home() {
  return (
    <>
      <Dashboard />
      <style>{`
        .chart-card .analytics-heading {
          display: flex !important;
          flex-direction: column;
          align-items: stretch !important;
          gap: 16px;
          overflow: visible;
        }

        .chart-card .analytics-heading > div:first-child {
          width: 100%;
          min-width: 0;
        }

        .chart-card .chart-title {
          display: grid;
          grid-template-columns: 38px minmax(0, max-content) max-content;
          align-items: center;
          justify-content: start;
          gap: 10px;
          width: 100%;
          min-width: 0;
          flex-wrap: nowrap;
        }

        .chart-card .chart-title h2 {
          min-width: 0;
          margin: 0;
          line-height: 1.15;
        }

        .chart-card .chart-title .chart-mode-badge {
          margin-left: 2px;
          padding: 4px 8px;
          font-size: 8px !important;
          line-height: 1.2;
          letter-spacing: .08em;
          white-space: nowrap;
        }

        .chart-card .analytics-heading p {
          margin: 8px 0 0 48px !important;
          max-width: 620px;
        }

        .chart-card .range-switch {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          gap: 4px;
          overflow: visible;
        }

        .chart-card .range-switch button {
          flex: 0 0 auto;
        }

        @media (max-width: 640px) {
          .chart-card .chart-title {
            grid-template-columns: 34px minmax(0, 1fr);
            gap: 9px;
          }

          .chart-card .chart-title .chart-mode-badge {
            grid-column: 2;
            width: max-content;
            margin-left: 0;
          }

          .chart-card .analytics-heading p {
            margin-left: 43px !important;
          }
        }

        @media (max-width: 420px) {
          .chart-card .analytics-heading p {
            margin-left: 0 !important;
          }

          .chart-card .range-switch button {
            flex: 1 1 auto;
          }
        }
      `}</style>
    </>
  );
}

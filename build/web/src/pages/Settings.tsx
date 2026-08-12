import { useEffect, useState } from "react";
import { api } from "../api";
import { Card } from "../components/Card";

// M0 shell — the full settings form (credentials, prompts, test buttons) lands in M2.
export function Settings() {
  const [interval, setIntervalValue] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((data) => setIntervalValue(data.values.check_interval))
      .catch(() => {});
  }, []);

  return (
    <main>
      <h1>Settings</h1>
      <p className="page-note">Credentials, schedule, and the two prompts that define your engine.</p>
      <Card>
        <p className="t-small" style={{ margin: 0 }}>
          Check interval: {interval ?? "…"}. The full settings form (credentials, prompts, test buttons)
          arrives with the Settings milestone.
        </p>
      </Card>
    </main>
  );
}

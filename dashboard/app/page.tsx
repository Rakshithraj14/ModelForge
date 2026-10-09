import { Dashboard } from "@/components/Dashboard";
import { Intro } from "@/components/Intro";
import { dashboardData } from "@/lib/data";

export default function Page() {
  return (
    <>
      <Intro />
      <Dashboard data={dashboardData} />
    </>
  );
}

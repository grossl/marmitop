import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/nav";

export default function Home() {
  redirect(HOME_PATH);
}

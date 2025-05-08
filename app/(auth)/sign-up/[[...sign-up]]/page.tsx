import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="flex justify-center items-center min-h-screen bg-dark-1 px-4">
      <div className="w-full max-w-md">
        <SignUp />
      </div>
    </main>
  );
}


import { Header } from "@/components/Header";

const Index = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg h-96 flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                Welcome to Video Analytics Platform
              </h1>
              <p className="text-lg text-gray-600">
                Your authenticated dashboard is ready. Start analyzing videos and building insights!
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;

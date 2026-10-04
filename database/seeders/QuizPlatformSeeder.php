<?php

namespace Database\Seeders;

use App\Models\FriendRequest;
use App\Models\Group;
use App\Models\Quiz;
use App\Models\Tag;
use App\Models\User;
use Illuminate\Database\Seeder;

class QuizPlatformSeeder extends Seeder
{
    public function run(): void
    {
        $tags = Tag::all()->keyBy('name');

        $alice = User::factory()->create([
            'name' => 'Alice Martin', 'email' => 'alice@example.com', 'ui_language' => 'en',
        ]);
        $bruno = User::factory()->create([
            'name' => 'Bruno Lefèvre', 'email' => 'bruno@example.com', 'ui_language' => 'fr',
        ]);
        $carla = User::factory()->create([
            'name' => 'Carla Gómez', 'email' => 'carla@example.com', 'ui_language' => 'es',
        ]);
        $dmitri = User::factory()->create([
            'name' => 'Dmitri Ivanov', 'email' => 'dmitri@example.com', 'ui_language' => 'ru',
        ]);
        $eve = User::factory()->create([
            'name' => 'Eve Chen', 'email' => 'eve@example.com', 'ui_language' => 'en',
        ]);

        $alice->tags()->attach($tags->only(['Geography', 'History'])->pluck('id'));
        $eve->tags()->attach($tags->only(['Science', 'Technology'])->pluck('id'));

        // Friendships: an accepted one, plus one still pending.
        FriendRequest::create(['sender_id' => $alice->id, 'recipient_id' => $eve->id, 'status' => 'accepted']);
        FriendRequest::create(['sender_id' => $carla->id, 'recipient_id' => $alice->id, 'status' => 'pending']);

        // A group with a few members.
        $group = Group::create(['owner_id' => $alice->id, 'name' => 'Trivia Night Crew']);
        $group->members()->attach([$alice->id, $eve->id, $bruno->id]);

        // Published quizzes across all four languages, each with real
        // questions/answers and at least one tag.
        $worldCapitals = $this->publishedQuiz($alice, 'World Capitals', 'en', ['Geography'], [
            ['Capital of Japan?', ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya'], 0],
            ['Capital of Australia?', ['Canberra', 'Sydney', 'Melbourne', 'Perth'], 0],
        ]);

        $this->publishedQuiz($bruno, 'Histoire de France', 'fr', ['History'], [
            ['En quelle année a eu lieu la Révolution française ?', ['1789', '1799', '1804', '1815'], 0],
        ]);

        $this->publishedQuiz($carla, 'Ciencia Básica', 'es', ['Science'], [
            ['¿Cuál es el símbolo químico del oro?', ['Au', 'Ag', 'Fe', 'Pb'], 0],
        ]);

        $historyRu = $this->publishedQuiz($dmitri, 'Мировая история', 'ru', ['History'], [
            ['В каком году началась Вторая мировая война?', ['1939', '1914', '1945', '1929'], 0],
        ]);

        $techQuiz = $this->publishedQuiz($eve, 'Tech Trivia', 'en', ['Technology', 'Science'], [
            ['Who co-founded Apple with Steve Jobs?', ['Steve Wozniak', 'Bill Gates', 'Elon Musk', 'Jeff Bezos'], 0],
            ['What does "HTTP" stand for?', ['HyperText Transfer Protocol', 'High Transfer Text Protocol', 'HyperText Transmission Process', 'Home Tool Transfer Protocol'], 0],
        ]);

        // Draft quizzes (unfinished, owner-only).
        Quiz::factory()->create(['user_id' => $alice->id, 'title' => 'Untitled Draft', 'language' => 'en']);
        Quiz::factory()->create(['user_id' => $eve->id, 'title' => 'Work in progress geography quiz', 'language' => 'en']);

        // Likes.
        $eve->likedQuizzes()->attach([$worldCapitals->id, $historyRu->id]);
        $alice->likedQuizzes()->attach($techQuiz->id);

        // Attempts: Eve passes the world-capitals quiz, Bruno fails the tech quiz.
        $this->recordAttempt($eve, $worldCapitals, correctCount: 2);
        $this->recordAttempt($bruno, $techQuiz, correctCount: 0);

        // A copy demonstrating lineage: Carla copies the tech quiz and
        // translates it into Spanish.
        $copy = $techQuiz->replicate(['status', 'published_at']);
        $copy->user_id = $carla->id;
        $copy->status = 'draft';
        $copy->language = 'es';
        $copy->copied_from_quiz_id = $techQuiz->id;
        $copy->save();
        $copy->tags()->sync($techQuiz->tags->pluck('id'));

        foreach ($techQuiz->questions as $question) {
            $newQuestion = $copy->questions()->create([
                'text' => $question->text,
                'order' => $question->order,
            ]);

            foreach ($question->answers as $answer) {
                $newQuestion->answers()->create([
                    'text' => $answer->text,
                    'is_correct' => $answer->is_correct,
                    'order' => $answer->order,
                ]);
            }
        }
    }

    /**
     * @param  list<string>  $tagNames
     * @param  list<array{0: string, 1: list<string>, 2: int}>  $questions  [text, answerTexts, correctIndex]
     */
    private function publishedQuiz(User $owner, string $title, string $language, array $tagNames, array $questions): Quiz
    {
        $quiz = Quiz::factory()->published()->create([
            'user_id' => $owner->id,
            'title' => $title,
            'language' => $language,
        ]);

        $quiz->tags()->attach(Tag::whereIn('name', $tagNames)->pluck('id'));

        foreach ($questions as $order => [$text, $answers, $correctIndex]) {
            $question = $quiz->questions()->create(['text' => $text, 'order' => $order]);

            foreach ($answers as $answerIndex => $answerText) {
                $question->answers()->create([
                    'text' => $answerText,
                    'is_correct' => $answerIndex === $correctIndex,
                    'order' => $answerIndex,
                ]);
            }
        }

        return $quiz;
    }

    private function recordAttempt(User $user, Quiz $quiz, int $correctCount): void
    {
        $total = $quiz->questions()->count();
        $percentage = $total > 0 ? (int) round(($correctCount / $total) * 100) : 0;

        $attempt = $user->quizAttempts()->create([
            'quiz_id' => $quiz->id,
            'total_questions' => $total,
            'correct_count' => $correctCount,
            'percentage' => $percentage,
            'passed' => $percentage >= config('quiz.passing_threshold_percent'),
        ]);

        foreach ($quiz->questions as $index => $question) {
            $correctAnswer = $question->answers->firstWhere('is_correct', true);
            $isCorrect = $index < $correctCount;

            $attempt->answers()->create([
                'question_id' => $question->id,
                'answer_id' => $isCorrect ? $correctAnswer->id : $question->answers->firstWhere('is_correct', false)->id,
                'is_correct' => $isCorrect,
            ]);
        }
    }
}

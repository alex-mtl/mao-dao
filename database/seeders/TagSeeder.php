<?php

namespace Database\Seeders;

use App\Models\Tag;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class TagSeeder extends Seeder
{
    public function run(): void
    {
        $tags = [
            'General Knowledge', 'Science', 'History', 'Geography', 'Sports',
            'Movies', 'Music', 'Literature', 'Technology', 'Video Games',
            'Art', 'Food & Drink', 'Nature', 'Mathematics', 'Language',
        ];

        foreach ($tags as $name) {
            Tag::firstOrCreate(
                ['slug' => Str::slug($name)],
                ['name' => $name],
            );
        }
    }
}

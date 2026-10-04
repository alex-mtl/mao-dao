<?php

namespace App\Http\Controllers;

use App\Services\NotificationFeedService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    /**
     * Returns the feed with each item's unread flag as it was *before*
     * this request, then marks everything read — opening the list is
     * what clears the bell's counter.
     */
    public function index(Request $request, NotificationFeedService $feed): JsonResponse
    {
        $user = $request->user();
        $items = $feed->items($user);

        $feed->markAllRead($user);

        return response()->json(['items' => $items]);
    }
}

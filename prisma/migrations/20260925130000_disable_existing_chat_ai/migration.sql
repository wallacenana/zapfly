UPDATE `chat`
SET `aiEnabled` = false,
    `aiManuallyPaused` = false
WHERE `aiEnabled` = true;

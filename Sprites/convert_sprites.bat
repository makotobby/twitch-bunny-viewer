@echo off
setlocal enabledelayedexpansion

echo =======================================
echo Starting Sprite Conversion
echo =======================================

echo Current directory: %CD%
echo Listing directories to process:
dir /ad /b

echo Checking ImageMagick installation...
where magick
if %ERRORLEVEL% neq 0 (
    echo ERROR: ImageMagick not found!
    goto :END
)

echo ImageMagick found. Starting conversion...

for /d %%d in (*) do (
    echo.
    echo =======================================
    echo Processing folder: %%d
    echo =======================================
    
    rem Check if the directory exists
    if not exist "%%d" (
        echo Directory %%d does not exist!
        goto :END
    )
    
    echo Listing files in %%d:
    dir "%%d" /b
    
    rem Create directory for frames if it doesn't exist
    if not exist "%%d\frames" (
        echo Creating frames directory...
        mkdir "%%d\frames"
    )
    
    rem Process Idle sprites (12 frames)
    if exist "%%d\Idle.png" (
        echo Found Idle.png...
        
        echo Slicing Idle.png into 12 frames...
        magick "%%d\Idle.png" -crop 12x1@ +repage "%%d\frames\idle_%%02d.png"
        echo ErrorLevel: %ERRORLEVEL%
        
        if exist "%%d\frames\idle_00.png" (
            echo Frame splitting successful.
            
            echo Creating Idle.gif from frames...
            magick -delay 10 -dispose Previous -loop 0 "%%d\frames\idle_*.png" "%%d\Idle.gif"
            echo ErrorLevel: %ERRORLEVEL%
            
            if exist "%%d\Idle.gif" (
                echo Successfully created %%d\Idle.gif
            ) else (
                echo Failed to create %%d\Idle.gif
                goto :END
            )
        ) else (
            echo No idle frames were created!
            goto :END
        )
        
        echo Cleaning up idle frames...
        del "%%d\frames\idle_*.png"
    ) else (
        echo Idle.png not found in %%d
    )
    
    rem Process Running sprites (8 frames)
    if exist "%%d\Running.png" (
        echo Found Running.png...
        
        echo Slicing Running.png into 8 frames...
        magick "%%d\Running.png" -crop 8x1@ +repage "%%d\frames\running_%%02d.png"
        echo ErrorLevel: %ERRORLEVEL%
        
        if exist "%%d\frames\running_00.png" (
            echo Frame splitting successful.
            
            echo Creating Running.gif from frames with special disposal method...
            magick -delay 8 -dispose Background -loop 0 "%%d\frames\running_*.png" "%%d\Running.gif"
            echo ErrorLevel: %ERRORLEVEL%
            
            if exist "%%d\Running.gif" (
                echo Successfully created %%d\Running.gif
            ) else (
                echo Failed to create %%d\Running.gif
                goto :END
            )
        ) else (
            echo No running frames were created!
            goto :END
        )
        
        echo Cleaning up running frames...
        del "%%d\frames\running_*.png"
    ) else (
        echo Running.png not found in %%d
    )
    
    rem Clean up frames directory
    rmdir "%%d\frames"
    
    echo Processing directory complete.
)

echo.
echo =======================================
echo All sprite conversions complete!
echo =======================================
goto :END

:END
echo.
echo Press any key to exit...
pause